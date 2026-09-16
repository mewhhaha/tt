#pragma once
#include "refine.hpp"
#include <cstring>
#include <deque>
#include <filesystem>

namespace tt {
enum class Op:uint8_t { Int,Bool,Text,Unit,Local,Capture,Native,Store,Closure,Call,Record,Field,Array,Add,Sub,Mul,Div,Mod,Eq,Ne,Lt,Le,Gt,Ge,Neg,Not,Jump,Branch,Return };
struct Ins { Op op;uint32_t a=0;int64_t b=0; };
struct Function { uint32_t locals=0,captures=0;bool parameter=false;std::vector<Ins> code; };
struct Program {
    std::vector<std::string> labels,texts;
    std::vector<std::vector<Id>> layouts;
    std::vector<Function> functions;
};
class Emit {
    Ast& ast;Program p;unsigned depth=0;
    struct Location { bool capture;uint32_t index; };
    using Scope=std::unordered_map<Id,Location>;
    std::unordered_map<Id,Id> natives;
    std::unordered_map<std::string,Id> textIds;
    Id emit(Id f,Op op,uint32_t a=0,int64_t b=0){auto& c=p.functions[f].code;c.push_back({op,a,b});return static_cast<Id>(c.size()-1);}
    void free(Id id,std::set<Id>& bound,std::set<Id>& out) {
        Depth guard(depth,ast.nodes[id].pos);auto& e=ast.nodes[id];
        if(e.kind==EK::Var){if(!bound.contains(e.binder)&&!natives.contains(e.binder))out.insert(e.binder);return;}
        if(e.kind==EK::Lambda){bound.insert(e.binder);free(e.a,bound,out);bound.erase(e.binder);return;}
        if(e.kind==EK::Block){for(auto& b:e.bindings){free(b.expr,bound,out);bound.insert(b.binder);}free(e.a,bound,out);for(auto& b:e.bindings)bound.erase(b.binder);return;}
        if(e.a!=NONE)free(e.a,bound,out);if(e.b!=NONE)free(e.b,bound,out);if(e.c!=NONE)free(e.c,bound,out);
        for(Id x:e.items)free(x,bound,out);for(auto [_,x]:e.fields)free(x,bound,out);
    }
    void load(Id binder,Id f,const Scope& scope) {
        auto ni=natives.find(binder);if(ni!=natives.end()){emit(f,Op::Native,ni->second);return;}
        auto it=scope.find(binder);if(it==scope.end())fail(0,"unresolved closure binding","E_INTERNAL");
        emit(f,it->second.capture?Op::Capture:Op::Local,it->second.index);
    }
    void expression(Id id,Id f,Scope& scope) {
        Depth guard(depth,ast.nodes[id].pos);auto& e=ast.nodes[id];
        switch(e.kind) {
            case EK::Int:emit(f,Op::Int,0,e.number);break;
            case EK::Bool:emit(f,Op::Bool,static_cast<Id>(e.number));break;
            case EK::Unit:emit(f,Op::Unit);break;
            case EK::Text:{auto [it,inserted]=textIds.emplace(e.text,static_cast<Id>(p.texts.size()));if(inserted)p.texts.push_back(e.text);emit(f,Op::Text,it->second);break;}
            case EK::Var:load(e.binder,f,scope);break;
            case EK::Lambda:{
                std::set<Id> bound{e.binder},captures;free(e.a,bound,captures);
                Id child=static_cast<Id>(p.functions.size());Function fn;fn.locals=1;fn.captures=static_cast<Id>(captures.size());fn.parameter=true;p.functions.push_back(std::move(fn));
                Scope inner;inner[e.binder]={false,0};Id index=0;
                for(Id cap:captures){load(cap,f,scope);inner[cap]={true,index++};}
                expression(e.a,child,inner);emit(child,Op::Return);emit(f,Op::Closure,child);break;
            }
            case EK::Call:expression(e.a,f,scope);expression(e.b,f,scope);emit(f,Op::Call);break;
            case EK::Record:{
                std::vector<Id> labels;for(auto [n,x]:e.fields){expression(x,f,scope);labels.push_back(n);}
                Id layout=static_cast<Id>(p.layouts.size());p.layouts.push_back(std::move(labels));emit(f,Op::Record,layout);break;
            }
            case EK::Field:expression(e.a,f,scope);emit(f,Op::Field,e.name);break;
            case EK::Array:for(Id x:e.items)expression(x,f,scope);emit(f,Op::Array,static_cast<Id>(e.items.size()));break;
            case EK::Unary:expression(e.a,f,scope);emit(f,e.text=="-"?Op::Neg:Op::Not);break;
            case EK::Binary:{
                expression(e.a,f,scope);
                if(e.text=="&&"||e.text=="||") {
                    Id branch=emit(f,Op::Branch);
                    if(e.text=="&&")expression(e.b,f,scope);else emit(f,Op::Bool,1);
                    Id jump=emit(f,Op::Jump);p.functions[f].code[branch].a=static_cast<Id>(p.functions[f].code.size());
                    if(e.text=="&&")emit(f,Op::Bool,0);else expression(e.b,f,scope);
                    p.functions[f].code[jump].a=static_cast<Id>(p.functions[f].code.size());
                } else {
                    expression(e.b,f,scope);
                    const std::map<std::string,Op> ops={{"+",Op::Add},{"-",Op::Sub},{"*",Op::Mul},{"/",Op::Div},{"%",Op::Mod},{"==",Op::Eq},{"!=",Op::Ne},{"<",Op::Lt},{"<=",Op::Le},{">",Op::Gt},{">=",Op::Ge}};
                    emit(f,ops.at(e.text));
                }
                break;
            }
            case EK::If:{
                expression(e.a,f,scope);Id branch=emit(f,Op::Branch);expression(e.b,f,scope);Id jump=emit(f,Op::Jump);
                p.functions[f].code[branch].a=static_cast<Id>(p.functions[f].code.size());expression(e.c,f,scope);
                p.functions[f].code[jump].a=static_cast<Id>(p.functions[f].code.size());break;
            }
            case EK::Block:
                for(auto& b:e.bindings){expression(b.expr,f,scope);Id slot=p.functions[f].locals++;scope[b.binder]={false,slot};emit(f,Op::Store,slot);}
                expression(e.a,f,scope);break;
        }
    }
public:
    Emit(Ast& a,const Infer& i):ast(a){for(Id n=0;n<i.builtins.size();++n)natives[i.builtins[n].binder]=n;}
    Program run(){p.labels=ast.symbols.names;p.functions.emplace_back();Scope scope;expression(ast.root,0,scope);emit(0,Op::Return);return std::move(p);}
};
inline void validate(const Program& p) {
    auto bad=[](const std::string& s){fail(0,s,"E_BYTECODE");};
    if(p.functions.empty()||p.functions.size()>200000)bad("invalid function count");
    if(p.functions[0].captures||p.functions[0].parameter)bad("invalid entry function");
    for(auto& layout:p.layouts){std::set<Id> seen;for(Id n:layout)if(n>=p.labels.size()||!seen.insert(n).second)bad("invalid record layout");}
    uint64_t total=0;
    for(auto& f:p.functions) {
        if(f.code.empty()||f.locals>200000||f.captures>200000||(f.parameter&&f.locals==0))bad("invalid function header");
        total+=f.code.size();if(total>2000000)bad("instruction limit exceeded");
        for(auto i:f.code) {
            if(i.op>Op::Return)bad("unknown instruction");
            if((i.op==Op::Local||i.op==Op::Store)&&i.a>=f.locals)bad("local index out of bounds");
            if(i.op==Op::Capture&&i.a>=f.captures)bad("capture index out of bounds");
            if(i.op==Op::Native&&i.a>=6)bad("unknown native operation");
            if(i.op==Op::Text&&i.a>=p.texts.size())bad("text index out of bounds");
            if(i.op==Op::Field&&i.a>=p.labels.size())bad("field index out of bounds");
            if(i.op==Op::Closure&&(i.a>=p.functions.size()||!p.functions[i.a].parameter))bad("invalid closure target");
            if(i.op==Op::Record&&i.a>=p.layouts.size())bad("record index out of bounds");
            if((i.op==Op::Branch||i.op==Op::Jump)&&i.a>=f.code.size())bad("jump out of bounds");
            if(i.op==Op::Bool&&i.a>1)bad("invalid Boolean constant");
            if(i.op==Op::Array&&i.a>1000000)bad("array operand too large");
        }
        std::vector<int64_t> heights(f.code.size(),-1);std::deque<Id> work;heights[0]=0;work.push_back(0);
        auto edge=[&](Id pc,int64_t h){if(pc>=f.code.size())bad("function falls through");if(heights[pc]<0){heights[pc]=h;work.push_back(pc);}else if(heights[pc]!=h)bad("inconsistent stack height");};
        while(!work.empty()) {
            Id pc=work.front();work.pop_front();auto i=f.code[pc];int64_t pop=0,push=0;
            switch(i.op) {
                case Op::Int:case Op::Bool:case Op::Text:case Op::Unit:case Op::Local:case Op::Capture:case Op::Native:push=1;break;
                case Op::Store:case Op::Branch:case Op::Return:pop=1;break;
                case Op::Closure:pop=p.functions[i.a].captures;push=1;break;
                case Op::Record:pop=static_cast<int64_t>(p.layouts[i.a].size());push=1;break;
                case Op::Array:pop=i.a;push=1;break;
                case Op::Neg:case Op::Not:case Op::Field:pop=push=1;break;
                case Op::Jump:break;
                default:pop=2;push=1;break;
            }
            if(heights[pc]<pop)bad("operand stack underflow");int64_t h=heights[pc]-pop+push;if(h>1000000)bad("operand stack limit exceeded");
            if(i.op==Op::Return){if(h!=0)bad("return has excess stack values");continue;}
            if(i.op==Op::Jump){edge(i.a,h);continue;}
            if(i.op==Op::Branch)edge(i.a,h);edge(pc+1,h);
        }
    }
}
// Versioned, little-endian wire format. Structural validation is not a typing certificate.
inline std::vector<uint8_t> encode(const Program& p) {
    validate(p);std::vector<uint8_t> bytes{'T','T','B','C'};
    auto u32=[&](uint32_t x){for(unsigned i=0;i<4;++i)bytes.push_back(static_cast<uint8_t>(x>>(8*i)));};
    auto u64=[&](uint64_t x){for(unsigned i=0;i<8;++i)bytes.push_back(static_cast<uint8_t>(x>>(8*i)));};
    auto strings=[&](const auto& xs){u32(static_cast<uint32_t>(xs.size()));for(auto& s:xs){u32(static_cast<uint32_t>(s.size()));bytes.insert(bytes.end(),s.begin(),s.end());}};
    u32(1);strings(p.labels);strings(p.texts);u32(static_cast<uint32_t>(p.layouts.size()));
    for(auto& l:p.layouts){u32(static_cast<uint32_t>(l.size()));for(Id n:l)u32(n);}
    u32(static_cast<uint32_t>(p.functions.size()));
    for(auto& f:p.functions){u32(f.locals);u32(f.captures);u32(f.parameter?1:0);u32(static_cast<uint32_t>(f.code.size()));for(auto i:f.code){bytes.push_back(static_cast<uint8_t>(i.op));u32(i.a);u64(static_cast<uint64_t>(i.b));}}
    return bytes;
}
inline Program decode(const std::vector<uint8_t>& bytes) {
    size_t at=0;
    auto bad=[](){fail(0,"malformed or unsupported bytecode","E_BYTECODE");};
    auto read=[&](unsigned n)->uint64_t{if(n>bytes.size()-at)bad();uint64_t r=0;for(unsigned i=0;i<n;++i)r|=uint64_t(bytes[at++])<<(8*i);return r;};
    auto count=[&](uint32_t max)->uint32_t{auto n=read(4);if(n>max)bad();return static_cast<uint32_t>(n);};
    if(bytes.size()>64*1024*1024)bad();
    if(read(4)!=0x43425454||read(4)!=1)bad();Program p;
    auto strings=[&](auto& xs){auto n=count(500000);for(Id i=0;i<n;++i){auto len=count(4*1024*1024);if(len>bytes.size()-at)bad();xs.emplace_back(reinterpret_cast<const char*>(bytes.data()+at),len);at+=len;}};
    strings(p.labels);strings(p.texts);auto n=count(200000);uint64_t layoutTotal=0;
    for(Id i=0;i<n;++i){auto len=count(200000);layoutTotal+=len;if(layoutTotal>2000000)bad();std::vector<Id> layout;for(Id j=0;j<len;++j)layout.push_back(static_cast<Id>(read(4)));p.layouts.push_back(std::move(layout));}
    n=count(200000);uint64_t instructionTotal=0;
    for(Id i=0;i<n;++i){Function f;f.locals=count(200000);f.captures=count(200000);f.parameter=count(1)!=0;auto len=count(2000000);instructionTotal+=len;if(instructionTotal>2000000)bad();for(Id j=0;j<len;++j){auto op=static_cast<Op>(read(1));auto a=static_cast<uint32_t>(read(4));uint64_t raw=read(8);int64_t b;static_assert(sizeof(b)==sizeof(raw));std::memcpy(&b,&raw,sizeof(b));f.code.push_back({op,a,b});}p.functions.push_back(std::move(f));}
    if(at!=bytes.size())bad();validate(p);return p;
}
struct Object;
struct Value {
    enum Kind { Unit,Int,Bool,Text,Array,Record,Closure,Native } kind=Unit;
    int64_t number=0;unsigned nesting=0;std::shared_ptr<Object> object;
    static Value integer(int64_t x){Value v;v.kind=Int;v.number=x;return v;}
    static Value boolean(bool x){Value v;v.kind=Bool;v.number=x;return v;}
};
struct Object { std::string text;std::vector<Value> values;std::vector<Id> labels;Id id=0; };
class VM {
    const Program& p;uint64_t remaining,allocated=0,textBytes=0,localCells=0;unsigned depth=0;
    [[noreturn]] void trap(const std::string& s){fail(0,s,"E_RUNTIME");}
    void charge(){if(remaining==0)fail(0,"execution fuel exhausted","E_LIMIT");--remaining;}
    Value object(Value::Kind k,std::vector<Value> vs={},Id id=0) {
        allocated+=vs.size()+1;if(allocated>1000000)fail(0,"allocation budget exhausted","E_LIMIT");
        Value v;v.kind=k;v.nesting=1;for(auto& x:vs)v.nesting=std::max(v.nesting,x.nesting+1);
        if(v.nesting>128)fail(0,"value nesting limit exceeded","E_LIMIT");
        v.object=std::make_shared<Object>();v.object->values=std::move(vs);v.object->id=id;return v;
    }
    void textAllocation(size_t n){textBytes+=n;if(textBytes>32*1024*1024)fail(0,"text allocation budget exhausted","E_LIMIT");}
    int64_t integer(const Value& v){if(v.kind!=Value::Int)trap("expected integer");return v.number;}
    bool boolean(const Value& v){if(v.kind!=Value::Bool)trap("expected Boolean");return v.number!=0;}
    int64_t checked(__int128 x){if(x<MIN||x>MAX)trap("integer overflow");return static_cast<int64_t>(x);}
    Value native(Id id,const std::vector<Value>& a) {
        charge();
        if(id==0||id==1||id==2||id==3) {
            size_t arrayAt=id==0||id==1?0:(id==2?1:2);
            if(a.at(arrayAt).kind!=Value::Array)trap("expected array");
        }
        switch(id) {
            case 0:return Value::integer(static_cast<int64_t>(a[0].object->values.size()));
            case 1:{auto index=integer(a[1]);auto& xs=a[0].object->values;if(index<0||uint64_t(index)>=xs.size())trap("array index out of bounds");return xs[static_cast<size_t>(index)];}
            case 2:{std::vector<Value> xs;for(auto& x:a[1].object->values){charge();xs.push_back(invoke(a[0],x));}return object(Value::Array,std::move(xs));}
            case 3:{Value acc=a[1];for(auto& x:a[2].object->values){charge();acc=invoke(invoke(a[0],acc),x);}return acc;}
            case 4:{if(a[0].kind!=Value::Text||a[1].kind!=Value::Text)trap("expected text");auto size=a[0].object->text.size()+a[1].object->text.size();if(size>4*1024*1024)fail(0,"text size limit exceeded","E_LIMIT");textAllocation(size);auto v=object(Value::Text);v.object->text=a[0].object->text+a[1].object->text;return v;}
            case 5:{if(a[0].kind!=Value::Text)trap("expected text");return Value::integer(static_cast<int64_t>(a[0].object->text.size()));}
            default:trap("unknown native operation");
        }
    }
    Value invoke(const Value& f,const Value& a) {
        Depth guard(depth,0);charge();
        if(f.kind==Value::Closure)return execute(f.object->id,f.object->values,a);
        if(f.kind==Value::Native) {
            static constexpr unsigned arities[]={1,2,2,3,2,1};Id id=f.object->id;if(id>=6)trap("unknown native operation");
            auto args=f.object->values;args.push_back(a);
            return args.size()==arities[id]?native(id,args):object(Value::Native,std::move(args),id);
        }
        trap("attempted to call non-function");
    }
    Value execute(Id id,const std::vector<Value>& captures,Value argument={}) {
        auto& f=p.functions.at(id);localCells+=f.locals;if(localCells>1000000)fail(0,"local allocation budget exhausted","E_LIMIT");std::vector<Value> locals(f.locals),stack;std::vector<bool> initialized(f.locals,false);
        if(f.parameter){locals.at(0)=std::move(argument);initialized.at(0)=true;}
        auto pop=[&](){if(stack.empty())trap("empty operand stack");auto v=std::move(stack.back());stack.pop_back();return v;};
        auto many=[&](size_t n){if(n>stack.size())trap("operand underflow");std::vector<Value> vs;vs.reserve(n);auto start=stack.size()-n;for(size_t i=start;i<stack.size();++i)vs.push_back(std::move(stack[i]));stack.resize(start);return vs;};
        for(size_t pc=0;pc<f.code.size();) {
            charge();auto i=f.code[pc++];
            switch(i.op) {
                case Op::Int:stack.push_back(Value::integer(i.b));break;
                case Op::Bool:stack.push_back(Value::boolean(i.a!=0));break;
                case Op::Unit:stack.emplace_back();break;
                case Op::Text:{textAllocation(p.texts.at(i.a).size());auto v=object(Value::Text);v.object->text=p.texts.at(i.a);stack.push_back(std::move(v));break;}
                case Op::Local:if(!initialized.at(i.a))trap("uninitialized local");stack.push_back(locals.at(i.a));break;
                case Op::Capture:stack.push_back(captures.at(i.a));break;
                case Op::Native:stack.push_back(object(Value::Native,{},i.a));break;
                case Op::Store:locals.at(i.a)=pop();initialized.at(i.a)=true;break;
                case Op::Closure:stack.push_back(object(Value::Closure,many(p.functions.at(i.a).captures),i.a));break;
                case Op::Call:{auto a=pop(),callee=pop();stack.push_back(invoke(callee,a));break;}
                case Op::Record:{auto v=object(Value::Record,many(p.layouts.at(i.a).size()));v.object->labels=p.layouts[i.a];stack.push_back(std::move(v));break;}
                case Op::Field:{auto v=pop();if(v.kind!=Value::Record)trap("expected record");auto& ls=v.object->labels;auto it=std::find(ls.begin(),ls.end(),i.a);if(it==ls.end())trap("missing record field");stack.push_back(v.object->values[static_cast<size_t>(it-ls.begin())]);break;}
                case Op::Array:stack.push_back(object(Value::Array,many(i.a)));break;
                case Op::Jump:pc=i.a;break;
                case Op::Branch:if(!boolean(pop()))pc=i.a;break;
                case Op::Neg:stack.push_back(Value::integer(checked(-__int128(integer(pop())))));break;
                case Op::Not:stack.push_back(Value::boolean(!boolean(pop())));break;
                case Op::Return:return pop();
                default:{
                    auto bv=pop(),av=pop();int64_t a=integer(av),b=integer(bv);Value v;
                    switch(i.op) {
                        case Op::Add:v=Value::integer(checked(__int128(a)+b));break;
                        case Op::Sub:v=Value::integer(checked(__int128(a)-b));break;
                        case Op::Mul:v=Value::integer(checked(__int128(a)*b));break;
                        case Op::Div:if(b==0)trap("division by zero");v=Value::integer(checked(__int128(a)/b));break;
                        case Op::Mod:if(b==0)trap("remainder by zero");v=Value::integer(static_cast<int64_t>(__int128(a)%b));break;
                        case Op::Eq:v=Value::boolean(a==b);break;case Op::Ne:v=Value::boolean(a!=b);break;
                        case Op::Lt:v=Value::boolean(a<b);break;case Op::Le:v=Value::boolean(a<=b);break;
                        case Op::Gt:v=Value::boolean(a>b);break;case Op::Ge:v=Value::boolean(a>=b);break;
                        default:trap("invalid operation");
                    }
                    stack.push_back(std::move(v));break;
                }
            }
        }
        trap("function fell through");
    }
public:
    explicit VM(const Program& program,uint64_t fuel=10000000):p(program),remaining(fuel){validate(p);}
    Value run(){return execute(0,{});}
};
inline std::string display(const Value& v,const Program& p,unsigned depth=0) {
    if(depth>64)return "...";
    switch(v.kind) {
        case Value::Unit:return "()";case Value::Int:return std::to_string(v.number);case Value::Bool:return v.number?"true":"false";
        case Value::Text:{std::string s="\"";for(char c:v.object->text){if(c=='\n')s+="\\n";else if(c=='\r')s+="\\r";else if(c=='\t')s+="\\t";else{if(c=='\"'||c=='\\')s+='\\';s+=c;}}return s+"\"";}
        case Value::Closure:case Value::Native:return "<fn>";
        case Value::Array:{std::string s="[";bool first=true;for(auto& x:v.object->values){if(!first)s+=", ";first=false;s+=display(x,p,depth+1);}return s+"]";}
        case Value::Record:{std::string s="{ ";for(size_t i=0;i<v.object->values.size();++i)s+="."+p.labels.at(v.object->labels[i])+" = "+display(v.object->values[i],p,depth+1)+"; ";return s+"}";}
    }
    return "?";
}
} // namespace tt
