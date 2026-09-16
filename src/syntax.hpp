#pragma once
#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <fstream>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace tt {
using Id = uint32_t;
constexpr Id NONE = std::numeric_limits<Id>::max();
constexpr int64_t MIN = std::numeric_limits<int64_t>::min();
constexpr int64_t MAX = std::numeric_limits<int64_t>::max();
struct Error : std::runtime_error {
    size_t pos;
    std::string code;
    Error(std::string c, size_t p, std::string m)
        : std::runtime_error(std::move(m)), pos(p), code(std::move(c)) {}
};
[[noreturn]] inline void fail(size_t p, const std::string& m, std::string code="E_TYPE") {
    throw Error(std::move(code), p, m);
}
struct Depth {
    unsigned& n;
    explicit Depth(unsigned& v, size_t p) : n(v) {
        if (n >= 256) fail(p,"nesting limit (256) exceeded", "E_LIMIT");
        ++n;
    }
    ~Depth() { --n; }
};
struct Symbols {
    std::vector<std::string> names;
    std::unordered_map<std::string,Id> ids;
    Id intern(std::string_view s) {
        auto [it, inserted] = ids.try_emplace(std::string(s),static_cast<Id>(names.size()));
        if (inserted) names.emplace_back(s);
        return it->second;
    }
    const std::string& name(Id i) const { return names.at(i); }
};
struct Range {
    int64_t lo, hi;
    bool operator==(const Range&) const = default;
};
// Canonical disjoint, non-adjacent closed intervals. No solver or arbitrary predicates.
struct Ranges {
    std::vector<Range> parts;
    static Ranges all() { return {{{MIN,MAX}}}; }
    static Ranges one(int64_t v) { return {{{v,v}}}; }
    static Ranges span(int64_t a, int64_t b) { return a<=b ? Ranges{{{a,b}}} : Ranges{}; }
    bool operator==(const Ranges&) const = default;
    bool full() const { return parts.size()==1 && parts[0]==Range{MIN,MAX}; }
    bool empty() const { return parts.empty(); }
    bool singleton() const { return parts.size()==1 && parts[0].lo==parts[0].hi; }
    static Ranges unite(Ranges a, const Ranges& b) {
        a.parts.insert(a.parts.end(),b.parts.begin(),b.parts.end());
        std::sort(a.parts.begin(),a.parts.end(),[](Range x,Range y){return x.lo<y.lo;});
        Ranges r;
        for (auto x:a.parts) {
            if (r.parts.empty() || (r.parts.back().hi!=MAX && x.lo>r.parts.back().hi+1)) r.parts.push_back(x);
            else r.parts.back().hi=std::max(r.parts.back().hi,x.hi);
        }
        if (r.parts.size()>256) fail(0,"interval partition limit (256) exceeded","E_LIMIT");
        return r;
    }
    static Ranges intersect(const Ranges& a,const Ranges& b) {
        Ranges r; size_t i=0,j=0;
        while(i<a.parts.size() && j<b.parts.size()) {
            auto x=a.parts[i],y=b.parts[j];
            if (std::max(x.lo,y.lo)<=std::min(x.hi,y.hi)) r.parts.push_back({std::max(x.lo,y.lo),std::min(x.hi,y.hi)});
            if (x.hi<y.hi) ++i; else ++j;
        }
        return r;
    }
    static Ranges complement(const Ranges& a) {
        Ranges r; int64_t next=MIN;
        for (auto x:a.parts) {
            if (next<x.lo) r.parts.push_back({next,x.lo-1});
            if (x.hi==MAX) return r;
            next=x.hi+1;
        }
        r.parts.push_back({next,MAX}); return r;
    }
    bool subset(const Ranges& b) const { return intersect(*this,b)==*this; }
    std::string str() const {
        if (empty()) return "Never";
        if (full()) return "Int";
        std::string s;
        for (auto x:parts) {
            if (!s.empty()) s+=" | ";
            if(x.lo==x.hi) s+=std::to_string(x.lo);
            else s+="Int["+std::to_string(x.lo)+".."+std::to_string(x.hi)+"]";
        }
        return s;
    }
};
inline Ranges comparison(std::string_view op,int64_t n) {
    if(op=="==") return Ranges::one(n);
    if(op=="!=") return Ranges::complement(Ranges::one(n));
    if(op=="<") return n==MIN ? Ranges{} : Ranges::span(MIN,n-1);
    if(op=="<=") return Ranges::span(MIN,n);
    if(op==">") return n==MAX ? Ranges{} : Ranges::span(n+1,MAX);
    if(op==">=") return Ranges::span(n,MAX);
    fail(0,"unsupported comparison","E_PARSE");
}
enum class CK { Int, Bool, Text, Unit, Array, Record, Function };
struct Contract;
using C = std::shared_ptr<const Contract>;
struct Contract {
    CK kind=CK::Unit;
    Ranges range=Ranges::all();
    C a,b;
    std::vector<std::pair<Id,C>> fields;
};
inline C contract(CK k,C a={},C b={}) {
    auto c=std::make_shared<Contract>(); c->kind=k;c->a=std::move(a);c->b=std::move(b);return c;
}
inline C intContract(Ranges r) {
    auto c=std::make_shared<Contract>(); c->kind=CK::Int;c->range=std::move(r);return c;
}
struct Token { std::string text; size_t pos; enum Kind { Word, Number, String, Punct, End } kind; };
inline std::vector<Token> lex(std::string_view s) {
    if(s.size()>4*1024*1024) fail(0,"source limit (4 MiB) exceeded","E_LIMIT");
    std::vector<Token> out; out.reserve(s.size()/4);
    size_t i=0;
    auto alpha=[](unsigned char c){return (c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='_'||c=='@';};
    while(i<s.size()) {
        unsigned char c=static_cast<unsigned char>(s[i]);
        if(c==' '||c=='\t'||c=='\r'||c=='\n') {++i;continue;}
        if(c=='/' && i+1<s.size() && s[i+1]=='/') {while(i<s.size()&&s[i]!='\n')++i;continue;}
        size_t p=i;
        if(alpha(c)) {
            ++i;while(i<s.size() && (alpha(static_cast<unsigned char>(s[i]))||(s[i]>='0'&&s[i]<='9')))++i;
            out.push_back({std::string(s.substr(p,i-p)),p,Token::Word});
        } else if(c>='0'&&c<='9') {
            ++i;while(i<s.size()&&s[i]>='0'&&s[i]<='9')++i;
            out.push_back({std::string(s.substr(p,i-p)),p,Token::Number});
        } else if(c=='"') {
            ++i;std::string v;bool closed=false;
            while(i<s.size()) {
                char x=s[i++]; if(x=='"'){closed=true;break;}
                if(x=='\\') {
                    if(i==s.size())break;
                    x=s[i++];
                    if(x=='n')x='\n';else if(x=='r')x='\r';else if(x=='t')x='\t';
                    else if(x!='"'&&x!='\\')fail(i-1,"unsupported string escape","E_PARSE");
                }
                v+=x;
            }
            if(!closed)fail(p,"unterminated string","E_PARSE");
            out.push_back({std::move(v),p,Token::String});
        } else {
            std::string v(1,s[i++]);
            if(i<s.size()) {
                auto two=v+s[i];
                if(two=="=>"||two=="->"||two=="::"||two=="=="||two=="!="||two=="<="||two==">="||two=="&&"||two=="||"||two=="..") {v=two;++i;}
            }
            if(std::string("(){}[];,:.=+-*/%<>!&|").find(v[0])==std::string::npos)fail(p,"invalid character","E_PARSE");
            out.push_back({v,p,Token::Punct});
        }
        if(out.size()>500000)fail(p,"token limit exceeded","E_LIMIT");
    }
    out.push_back({"",s.size(),Token::End});return out;
}
enum class EK { Int, Bool, Text, Unit, Var, Lambda, Call, Record, Field, Array, Binary, Unary, If, Block };
struct Binding { Id name=NONE,expr=NONE,binder=NONE; C annotation; size_t pos=0; };
struct Expr {
    EK kind=EK::Unit; size_t pos=0; Id a=NONE,b=NONE,c=NONE,name=NONE,binder=NONE,type=NONE,paramType=NONE;
    int64_t number=0;std::string text;C annotation;
    std::vector<Id> items;
    std::vector<std::pair<Id,Id>> fields;
    std::vector<Binding> bindings;
};
struct Ast {
    Symbols symbols;
    std::vector<Expr> nodes;
    Id root=NONE;
    Id add(Expr e) {
        if(nodes.size()>=200000)fail(e.pos,"AST node limit exceeded","E_LIMIT");
        nodes.push_back(std::move(e));return static_cast<Id>(nodes.size()-1);
    }
};
class Parser {
    std::vector<Token> ts;size_t at=0;unsigned depth=0;Ast ast;
    std::unordered_map<Id,C> aliases;
    const Token& t() const{return ts[at];}
    bool is(std::string_view x)const{return t().kind!=Token::String&&t().text==x;}
    bool eat(std::string_view x){if(is(x)){++at;return true;}return false;}
    Token take(){return ts.at(at++);}
    void need(std::string_view x){if(!eat(x))fail(t().pos,"expected '"+std::string(x)+"'","E_PARSE");}
    Id word(){if(t().kind!=Token::Word)fail(t().pos,"expected name","E_PARSE");return ast.symbols.intern(take().text);}
    int64_t integer(bool negative=false) {
        if(t().kind!=Token::Number)fail(t().pos,"expected integer literal","E_PARSE");
        auto tok=take();uint64_t v=0;
        auto [ptr,ec]=std::from_chars(tok.text.data(),tok.text.data()+tok.text.size(),v);
        uint64_t bound=uint64_t(MAX)+(negative?1:0);
        if(ec!=std::errc{}||ptr!=tok.text.data()+tok.text.size()||v>bound)fail(tok.pos,"integer literal outside signed 64-bit domain","E_PARSE");
        if(negative&&v==uint64_t(MAX)+1)return MIN;
        return negative?-static_cast<int64_t>(v):static_cast<int64_t>(v);
    }
    C typeAtom() {
        Depth guard(depth,t().pos);C r;
        if(eat("(")){r=type();need(")");}
        else if(eat("[")){r=contract(CK::Array,type());need("]");}
        else if(eat("{")) {
            auto q=std::make_shared<Contract>();q->kind=CK::Record;
            std::set<Id> seen;
            while(!eat("}")) {
                eat(".");Id n=word();if(!seen.insert(n).second)fail(t().pos,"duplicate type field","E_PARSE");
                if(!eat(":")&&!eat("::")&&!eat("="))need(":");
                q->fields.push_back({n,type()});
                if(!eat(";")){need("}");break;}
            }
            std::sort(q->fields.begin(),q->fields.end());r=q;
        } else {
            auto p=t().pos;Id n=word();auto name=ast.symbols.name(n);
            if(name=="Int")r=intContract(Ranges::all());
            else if(name=="Bool")r=contract(CK::Bool);
            else if(name=="Text")r=contract(CK::Text);
            else if(name=="Unit")r=contract(CK::Unit);
            else {auto it=aliases.find(n);if(it==aliases.end())fail(p,"unknown type '"+name+"'","E_PARSE");r=it->second;}
        }
        if(eat("where")) {
            if(r->kind!=CK::Int)fail(t().pos,"this prototype refines only Int with literal comparisons","E_UNSUPPORTED");
            auto ranges=r->range;
            do {
                need("self");auto op=take();
                if(op.text!="<"&&op.text!=">"&&op.text!="<="&&op.text!=">="&&op.text!="=="&&op.text!="!=")fail(op.pos,"expected refinement comparison","E_PARSE");
                bool neg=eat("-");auto n=integer(neg);
                ranges=Ranges::intersect(ranges,comparison(op.text,n));
            } while(eat("&&"));
            r=intContract(std::move(ranges));
        }
        return r;
    }
    C type() {
        Depth guard(depth,t().pos);C r=typeAtom();
        while(is("&")||is("|")) {
            bool meet=eat("&");if(!meet)need("|");auto b=typeAtom();
            if(r->kind!=CK::Int||b->kind!=CK::Int)fail(t().pos,"Boolean type composition currently supports Int predicates only","E_UNSUPPORTED");
            r=intContract(meet?Ranges::intersect(r->range,b->range):Ranges::unite(r->range,b->range));
        }
        if(eat("->"))r=contract(CK::Function,r,type());return r;
    }
    bool startsAtom()const {
        if(t().kind==Token::Number||t().kind==Token::String)return true;
        if(t().kind==Token::Word) return !is("then")&&!is("else")&&!is("return")&&!is("let")&&!is("const")&&!is("where");
        return is("(")||is("[")||is("{");
    }
    int precedence()const {
        if(is("||"))return 1;if(is("&&"))return 2;
        if(is("==")||is("!="))return 3;
        if(is("<")||is("<=")||is(">")||is(">="))return 4;
        if(is("+")||is("-"))return 5;
        if(is("*")||is("/")||is("%"))return 6;
        return -1;
    }
    Id atom() {
        Depth guard(depth,t().pos);Expr e;e.pos=t().pos;
        if(t().kind==Token::Number){e.kind=EK::Int;e.number=integer();}
        else if(t().kind==Token::String){e.kind=EK::Text;e.text=take().text;}
        else if(eat("true")){e.kind=EK::Bool;e.number=1;}
        else if(eat("false")){e.kind=EK::Bool;e.number=0;}
        else if(eat("fn")) {
            e.kind=EK::Lambda;bool par=eat("(");e.name=word();
            if(eat("::")||eat(":"))e.annotation=type();
            if(par)need(")");need("=>");e.a=expr();
        } else if(eat("if")) {
            e.kind=EK::If;e.a=expr();need("then");e.b=expr();need("else");e.c=expr();
        } else if(eat("do")){need("{");return block(false);}
        else if(eat("(")) {if(eat(")")){e.kind=EK::Unit;}else{auto x=expr();need(")");return x;}}
        else if(eat("[")) {
            e.kind=EK::Array;
            while(!eat("]")){e.items.push_back(expr());if(!eat(",")){need("]");break;}}
        } else if(eat("{")) {
            e.kind=EK::Record;std::set<Id> seen;
            while(!eat("}")) {
                eat(".");Id n=word();if(!seen.insert(n).second)fail(t().pos,"duplicate record field","E_PARSE");
                need("=");auto x=expr();e.fields.push_back({n,x});
                if(!eat(";")){need("}");break;}
            }
            // Keep evaluation order; lowering uses a separate sorted layout.
        } else if(t().kind==Token::Word){e.kind=EK::Var;e.name=word();}
        else fail(t().pos,"expected expression","E_PARSE");
        return ast.add(std::move(e));
    }
    Id postfix() {auto x=atom();while(eat(".")){Expr e;e.pos=t().pos;e.kind=EK::Field;e.a=x;e.name=word();x=ast.add(std::move(e));}return x;}
    Id unary() {
        Depth guard(depth,t().pos);
        if(is("-")||is("!")) {
            auto op=take();Expr e;e.pos=op.pos;
            if(op.text=="-"&&t().kind==Token::Number){e.kind=EK::Int;e.number=integer(true);}
            else{e.kind=EK::Unary;e.text=op.text;e.a=unary();}
            return ast.add(std::move(e));
        }
        return postfix();
    }
    Id expr(int min=0) {
        Depth guard(depth,t().pos);Id x=unary();
        for(;;) {
            if(startsAtom()&&7>=min) {
                Expr e;e.pos=ast.nodes[x].pos;e.kind=EK::Call;e.a=x;e.b=expr(8);x=ast.add(std::move(e));continue;
            }
            int p=precedence();if(p<min)break;
            auto op=take();Expr e;e.pos=op.pos;e.kind=EK::Binary;e.text=op.text;e.a=x;e.b=expr(p+1);x=ast.add(std::move(e));
        }
        return x;
    }
    Id block(bool top) {
        Depth guard(depth,t().pos);Expr e;e.kind=EK::Block;e.pos=t().pos;
        while(is("let")||is("const")) {
            if(eat("const")) {
                if(!top)fail(t().pos,"type aliases are module-level in this prototype","E_UNSUPPORTED");
                Id n=word();need("=");auto c=type();need(";");
                if(!aliases.emplace(n,c).second)fail(t().pos,"duplicate type alias","E_PARSE");
            } else {
                need("let");Binding b;b.pos=t().pos;b.name=word();
                if(eat("::"))b.annotation=type();need("=");b.expr=expr();need(";");e.bindings.push_back(std::move(b));
            }
        }
        need("return");e.a=expr();eat(";");
        if(top){if(t().kind!=Token::End)fail(t().pos,"unexpected text after module return","E_PARSE");}
        else need("}");
        return ast.add(std::move(e));
    }
public:
    explicit Parser(std::string_view source):ts(lex(source)){}
    Ast parse(){ast.root=block(true);return std::move(ast);}
};
} // namespace tt
