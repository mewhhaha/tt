#pragma once
#include "syntax.hpp"

namespace tt {
enum class TK { Var, Int, Bool, Text, Unit, Array, Function, Record, Row };
struct Type {
    TK kind=TK::Unit;Id a=NONE,b=NONE;unsigned level=0;bool rowVar=false;
    std::vector<std::pair<Id,Id>> fields;
};
struct Metrics {
    uint64_t unify=0, occurs=0, instantiate=0, generalize=0, projections=0, proof=0;
    double parseMs=0,typeMs=0,refineMs=0,emitMs=0;
};
class Types {
    unsigned depth=0;
public:
    std::vector<Type> nodes;
    Metrics metrics;
    Id integer,boolean,text,unit,emptyRow;
    Types() {
        integer=add(Type{TK::Int});boolean=add(Type{TK::Bool});
        text=add(Type{TK::Text});unit=add(Type{TK::Unit});emptyRow=add(Type{TK::Row});
    }
    Id add(Type t) {
        if(nodes.size()>=1000000)fail(0,"type node limit exceeded","E_LIMIT");
        nodes.push_back(std::move(t));return static_cast<Id>(nodes.size()-1);
    }
    Id fresh(unsigned level,bool row=false){Type t;t.kind=TK::Var;t.level=level;t.rowVar=row;return add(t);}
    Id array(Id a){Type t;t.kind=TK::Array;t.a=a;return add(t);}
    Id function(Id a,Id b){Type t;t.kind=TK::Function;t.a=a;t.b=b;return add(t);}
    Id row(std::vector<std::pair<Id,Id>> fs,Id tail=NONE){Type t;t.kind=TK::Row;t.fields=std::move(fs);t.a=tail;return add(std::move(t));}
    Id record(std::vector<std::pair<Id,Id>> fs,Id tail=NONE){Type t;t.kind=TK::Record;t.a=row(std::move(fs),tail);return add(t);}
    Id find(Id x) {
        Id root=x;
        while(nodes.at(root).kind==TK::Var&&nodes[root].a!=NONE)root=nodes[root].a;
        while(x!=root&&nodes[x].kind==TK::Var&&nodes[x].a!=NONE){Id next=nodes[x].a;nodes[x].a=root;x=next;}
        return root;
    }
    void lowerAndOccurs(Id variable,Id value,unsigned level,size_t pos) {
        std::vector<Id> work{value};std::unordered_set<Id> seen;
        while(!work.empty()) {
            Id x=find(work.back());work.pop_back();if(!seen.insert(x).second)continue;++metrics.occurs;
            if(x==variable)fail(pos,"infinite type (occurs check)");
            auto t=nodes[x];
            if(t.kind==TK::Var)nodes[x].level=std::min(t.level,level);
            else {
                if(t.a!=NONE)work.push_back(t.a);if(t.b!=NONE)work.push_back(t.b);
                for(auto [_,v]:t.fields)work.push_back(v);
            }
        }
    }
    void flatten(Id root,std::map<Id,Id>& fields,Id& tail,size_t pos=0) {
        std::unordered_set<Id> seen;
        for(Id x=find(root);;) {
            if(!seen.insert(x).second)fail(pos,"cyclic row","E_INTERNAL");
            auto t=nodes[x];
            if(t.kind==TK::Var){tail=x;return;}
            if(t.kind!=TK::Row)fail(pos,"invalid row node","E_INTERNAL");
            for(auto [n,v]:t.fields) {
                auto [it,newField]=fields.emplace(n,v);
                if(!newField)unify(it->second,v,pos);
            }
            if(t.a==NONE){tail=NONE;return;}x=find(t.a);
        }
    }
    void unifyRows(Id a,Id b,size_t pos) {
        std::map<Id,Id> af,bf;Id atail,btail;flatten(a,af,atail,pos);flatten(b,bf,btail,pos);
        std::vector<std::pair<Id,Id>> onlyA,onlyB;
        for(auto [n,v]:af){auto it=bf.find(n);if(it==bf.end())onlyA.push_back({n,v});else unify(v,it->second,pos);}
        for(auto [n,v]:bf)if(!af.contains(n))onlyB.push_back({n,v});
        if(onlyA.empty()&&onlyB.empty()) {unify(atail==NONE?emptyRow:atail,btail==NONE?emptyRow:btail,pos);return;}
        if((atail==NONE&&!onlyB.empty())||(btail==NONE&&!onlyA.empty()))fail(pos,"record does not provide the required fields");
        if(atail!=NONE&&btail!=NONE&&find(atail)==find(btail))fail(pos,"infinite row (incompatible fields on the same tail)");
        if(onlyA.empty()){unify(atail,row(std::move(onlyB),btail),pos);return;}
        if(onlyB.empty()){unify(btail,row(std::move(onlyA),atail),pos);return;}
        unsigned l=std::min(nodes[find(atail)].level,nodes[find(btail)].level);
        Id rest=fresh(l,true);
        unify(atail,row(std::move(onlyB),rest),pos);unify(btail,row(std::move(onlyA),rest),pos);
    }
    void unify(Id a,Id b,size_t pos) {
        Depth guard(depth,pos);++metrics.unify;a=find(a);b=find(b);if(a==b)return;
        auto x=nodes[a],y=nodes[b];
        if(x.kind==TK::Var) {
            bool yrow=y.kind==TK::Row||(y.kind==TK::Var&&y.rowVar);
            if(x.rowVar!=yrow)fail(pos,"row/type kind mismatch");
            lowerAndOccurs(a,b,x.level,pos);nodes[a].a=b;return;
        }
        if(y.kind==TK::Var){unify(b,a,pos);return;}
        if(x.kind!=y.kind)fail(pos,"incompatible type shapes");
        switch(x.kind) {
            case TK::Function:unify(x.a,y.a,pos);unify(x.b,y.b,pos);break;
            case TK::Array:case TK::Record:unify(x.a,y.a,pos);break;
            case TK::Row:unifyRows(a,b,pos);break;
            default:break;
        }
    }
    bool polymorphic(Id root,unsigned cutoff) {
        std::vector<Id> work{root};std::unordered_set<Id> seen;
        while(!work.empty()) {
            Id id=find(work.back());work.pop_back();if(!seen.insert(id).second)continue;++metrics.generalize;
            auto t=nodes[id];
            if(t.kind==TK::Var){if(t.level>cutoff)return true;}
            else {if(t.a!=NONE)work.push_back(t.a);if(t.b!=NONE)work.push_back(t.b);for(auto [_,v]:t.fields)work.push_back(v);}
        }
        return false;
    }
    Id project(Id recordType,Id label,unsigned level,size_t pos) {
        Id root=find(recordType);auto t=nodes[root];
        if(t.kind==TK::Var) {
            Id value=fresh(level);unify(root,record({{label,value}},fresh(level,true)),pos);return value;
        }
        if(t.kind!=TK::Record)fail(pos,"field projection requires a record");
        Id at=t.a;
        for(;;) {
            at=find(at);++metrics.projections;const auto& r=nodes[at];
            if(r.kind==TK::Var){Id value=fresh(level);unify(at,row({{label,value}},fresh(level,true)),pos);return value;}
            auto it=std::lower_bound(r.fields.begin(),r.fields.end(),label,[](auto entry,Id name){return entry.first<name;});
            if(it!=r.fields.end()&&it->first==label)return it->second;
            if(r.a==NONE)fail(pos,"record does not provide the required field");at=r.a;
        }
    }
    Id instantiate(Id root,unsigned cutoff,unsigned level) {
        std::unordered_map<Id,Id> copied;
        std::function<Id(Id)> copy=[&](Id x)->Id {
            Depth guard(depth,0);x=find(x);++metrics.instantiate;
            auto it=copied.find(x);if(it!=copied.end())return it->second;
            auto t=nodes[x];
            if(t.kind==TK::Var){Id r=t.level>cutoff?fresh(level,t.rowVar):x;copied[x]=r;return r;}
            bool changed=false;
            if(t.a!=NONE){Id old=t.a;t.a=copy(t.a);changed|=old!=t.a;}
            if(t.b!=NONE){Id old=t.b;t.b=copy(t.b);changed|=old!=t.b;}
            for(auto& [_,v]:t.fields){Id old=v;v=copy(v);changed|=old!=v;}
            Id r=changed?add(std::move(t)):x;copied[x]=r;return r;
        };
        return copy(root);
    }
    Id from(C c,unsigned level) {
        Depth guard(depth,0);
        switch(c->kind) {
            case CK::Int:return integer;case CK::Bool:return boolean;case CK::Text:return text;case CK::Unit:return unit;
            case CK::Array:return array(from(c->a,level));
            case CK::Function:{Id a=from(c->a,level),b=from(c->b,level);return function(a,b);}
            case CK::Record:{std::vector<std::pair<Id,Id>> fs;for(auto [n,v]:c->fields)fs.push_back({n,from(v,level)});return record(std::move(fs),fresh(level,true));}
        }
        fail(0,"unknown contract","E_INTERNAL");
    }
    Id fieldType(Id t,Id label) {
        auto n=nodes[find(t)];if(n.kind!=TK::Record)fail(0,"field evidence on non-record","E_INTERNAL");
        std::map<Id,Id> fs;Id tail;flatten(n.a,fs,tail);
        auto it=fs.find(label);if(it==fs.end())fail(0,"missing field type","E_INTERNAL");return it->second;
    }
    std::string show(Id root,const Symbols& symbols) {
        std::unordered_map<Id,unsigned> vars;size_t visits=0;
        std::function<std::string(Id,unsigned)> go=[&](Id x,unsigned d)->std::string {
            if(d>48||++visits>4096)return "...";
            x=find(x);auto t=nodes[x];
            switch(t.kind) {
                case TK::Var:{auto [it,_]=vars.emplace(x,static_cast<unsigned>(vars.size()));return std::string(t.rowVar?"..r":"'t")+std::to_string(it->second);}
                case TK::Int:return "Int";case TK::Bool:return "Bool";case TK::Text:return "Text";case TK::Unit:return "Unit";
                case TK::Array:return "["+go(t.a,d+1)+"]";
                case TK::Function:return "("+go(t.a,d+1)+" -> "+go(t.b,d+1)+")";
                case TK::Record:return go(t.a,d+1);
                case TK::Row:{std::map<Id,Id> fs;Id tail;flatten(x,fs,tail);std::string s="{ ";for(auto [n,v]:fs)s+="."+symbols.name(n)+": "+go(v,d+1)+"; ";if(tail!=NONE)s+=go(tail,d+1)+" ";return s+"}";}
            }
            return "?";
        };
        return go(root,0);
    }
};
struct Scheme { Id type,binder;unsigned cutoff;bool polymorphic=false; };
struct Builtin { std::string name;Id binder,type;unsigned arity; };
class Infer {
    Ast& ast;Types& types;unsigned depth=0;Id nextBinder=0;
    std::vector<std::unordered_map<Id,Scheme>> env;
    Scheme lookup(Id n,size_t p) {
        for(auto it=env.rbegin();it!=env.rend();++it){auto found=it->find(n);if(found!=it->end())return found->second;}
        fail(p,"unbound name '"+ast.symbols.name(n)+"'","E_NAME");
    }
    Id expression(Id id,unsigned level) {
        Depth guard(depth,ast.nodes[id].pos);auto& e=ast.nodes[id];Id out=NONE;
        switch(e.kind) {
            case EK::Int:out=types.integer;break;case EK::Bool:out=types.boolean;break;
            case EK::Text:out=types.text;break;case EK::Unit:out=types.unit;break;
            case EK::Var:{auto s=lookup(e.name,e.pos);e.binder=s.binder;out=s.polymorphic?types.instantiate(s.type,s.cutoff,level):s.type;break;}
            case EK::Lambda:{
                Id param=e.annotation?types.from(e.annotation,level):types.fresh(level);e.paramType=param;e.binder=nextBinder++;
                env.emplace_back();env.back()[e.name]={param,e.binder,std::numeric_limits<unsigned>::max()};
                Id body=expression(e.a,level);env.pop_back();out=types.function(param,body);break;
            }
            case EK::Call:{Id f=expression(e.a,level),a=expression(e.b,level);out=types.fresh(level);types.unify(f,types.function(a,out),e.pos);break;}
            case EK::Record:{std::vector<std::pair<Id,Id>> fs;for(auto [n,x]:e.fields)fs.push_back({n,expression(x,level)});std::sort(fs.begin(),fs.end());out=types.record(std::move(fs));break;}
            case EK::Field:{Id r=expression(e.a,level);out=types.project(r,e.name,level,e.pos);break;}
            case EK::Array:{Id elem=types.fresh(level);for(Id x:e.items)types.unify(elem,expression(x,level),e.pos);out=types.array(elem);break;}
            case EK::Binary:{
                Id a=expression(e.a,level),b=expression(e.b,level);
                bool logic=e.text=="&&"||e.text=="||";
                types.unify(a,logic?types.boolean:types.integer,e.pos);types.unify(b,logic?types.boolean:types.integer,e.pos);
                bool arithmetic=e.text=="+"||e.text=="-"||e.text=="*"||e.text=="/"||e.text=="%";
                out=arithmetic?types.integer:types.boolean;break;
            }
            case EK::Unary:{Id a=expression(e.a,level);out=e.text=="!"?types.boolean:types.integer;types.unify(a,out,e.pos);break;}
            case EK::If:{types.unify(expression(e.a,level),types.boolean,e.pos);out=expression(e.b,level);types.unify(out,expression(e.c,level),e.pos);break;}
            case EK::Block:{
                env.emplace_back();
                for(auto& b:e.bindings) {
                    Id t=expression(b.expr,level+1);
                    if(b.annotation)types.unify(t,types.from(b.annotation,level+1),b.pos);
                    b.binder=nextBinder++;env.back()[b.name]={t,b.binder,level,types.polymorphic(t,level)};
                }
                out=expression(e.a,level);env.pop_back();break;
            }
        }
        e.type=out;return out;
    }
public:
    std::vector<Builtin> builtins;
    Infer(Ast& a,Types& t):ast(a),types(t) {
        env.emplace_back();
        auto add=[&](std::string name,Id type,unsigned arity){Id n=ast.symbols.intern(name),b=nextBinder++;env.back()[n]={type,b,0,types.polymorphic(type,0)};builtins.push_back({std::move(name),b,type,arity});};
        auto arrow=[&](Id left,Id right){return types.function(left,right);};
        Id a1=types.fresh(1);add("length",arrow(types.array(a1),types.integer),1);
        Id a2=types.fresh(1);add("get",arrow(types.array(a2),arrow(types.integer,a2)),2);
        Id a3=types.fresh(1),b3=types.fresh(1);add("map",arrow(arrow(a3,b3),arrow(types.array(a3),types.array(b3))),2);
        Id a4=types.fresh(1),b4=types.fresh(1);add("fold",arrow(arrow(a4,arrow(b4,a4)),arrow(a4,arrow(types.array(b4),a4))),3);
        add("concat",arrow(types.text,arrow(types.text,types.text)),2);
        add("textLength",arrow(types.text,types.integer),1);
    }
    Id run(){return expression(ast.root,0);}
    Id bindingCount()const{return nextBinder;}
};
} // namespace tt
