#pragma once
#include "types.hpp"

namespace tt {
struct Evidence;
using P=std::shared_ptr<const Evidence>;
struct Evidence {
    enum Kind { Integer, Array, Record, Function, Bottom } kind=Integer;
    Ranges range;
    P a,b;
    std::map<Id,P> fields;
};
// Null means the occurrence's full structural type, not an untyped universal value.
inline P intEvidence(Ranges r) {
    if(r.full())return {};
    auto p=std::make_shared<Evidence>();p->range=std::move(r);return p;
}
inline P pairEvidence(Evidence::Kind k,P a,P b={}) {
    if(k==Evidence::Function&&!a&&!b)return {};
    auto p=std::make_shared<Evidence>();p->kind=k;p->a=std::move(a);p->b=std::move(b);return p;
}
inline P bottomEvidence(){auto p=std::make_shared<Evidence>();p->kind=Evidence::Bottom;return p;}
inline bool bottom(P p){return p&&p->kind==Evidence::Bottom;}
inline Ranges ranges(P p){return bottom(p)?Ranges{}:(p&&p->kind==Evidence::Integer?p->range:Ranges::all());}
inline P part(P p,bool right=false){return p?(right?p->b:p->a):P{};}
inline P field(P p,Id n){if(!p)return {};auto it=p->fields.find(n);return it==p->fields.end()?P{}:it->second;}
inline P evidence(C c) {
    switch(c->kind) {
        case CK::Int:return intEvidence(c->range);
        case CK::Function:return pairEvidence(Evidence::Function,evidence(c->a),evidence(c->b));
        case CK::Array:return pairEvidence(Evidence::Array,evidence(c->a));
        case CK::Record:{auto p=std::make_shared<Evidence>();p->kind=Evidence::Record;for(auto [n,v]:c->fields)p->fields[n]=evidence(v);return p;}
        default:return {};
    }
}
class Refine {
    Ast& ast;Types& types;std::vector<P> env;unsigned depth=0;bool unreachable=false;
    void step(size_t pos) {if(++types.metrics.proof>2000000)fail(pos,"refinement work limit exceeded","E_LIMIT");}
    bool same(P a,P b) {
        Depth guard(depth,0);step(0);
        if(a==b)return true;if(!a||!b)return false;
        if(a->kind!=b->kind||a->range!=b->range||a->fields.size()!=b->fields.size())return false;
        if(!same(a->a,b->a)||!same(a->b,b->b))return false;
        auto i=a->fields.begin(),j=b->fields.begin();
        for(;i!=a->fields.end();++i,++j)if(i->first!=j->first||!same(i->second,j->second))return false;
        return true;
    }
    bool entails(P actual,P required,Id type,size_t pos) {
        Depth guard(depth,pos);step(pos);
        if(actual==required||bottom(actual))return true;
        if(bottom(required))return false;
        auto t=types.nodes[types.find(type)];
        switch(t.kind) {
            case TK::Int:return ranges(actual).subset(ranges(required));
            case TK::Function:return entails(part(required),part(actual),t.a,pos)&&entails(part(actual,true),part(required,true),t.b,pos);
            case TK::Array:return entails(part(actual),part(required),t.a,pos);
            case TK::Record:{
                std::map<Id,Id> fs;Id tail;types.flatten(t.a,fs,tail,pos);
                for(auto [n,ty]:fs)if(!entails(field(actual,n),field(required,n),ty,pos))return false;
                return true;
            }
            default:return !required; // Unknown polymorphic positions cannot manufacture evidence.
        }
    }
    void require(P actual,P expected,Id type,size_t pos) {
        if(!entails(actual,expected,type,pos)) {
            std::string extra;
            if(types.nodes[types.find(type)].kind==TK::Int)extra="; have "+ranges(actual).str()+", need "+ranges(expected).str();
            fail(pos,"refinement contract not established"+extra,"E_REFINEMENT");
        }
    }
    P join(P a,P b,Id type,size_t pos) {
        Depth guard(depth,pos);step(pos);if(bottom(a))return b;if(bottom(b))return a;if(same(a,b))return a;
        auto t=types.nodes[types.find(type)];
        switch(t.kind) {
            case TK::Int:return intEvidence(Ranges::unite(ranges(a),ranges(b)));
            case TK::Array:return pairEvidence(Evidence::Array,join(part(a),part(b),t.a,pos));
            case TK::Record:{auto p=std::make_shared<Evidence>();p->kind=Evidence::Record;std::map<Id,Id> fs;Id tail;types.flatten(t.a,fs,tail,pos);for(auto [n,ty]:fs)p->fields[n]=join(field(a,n),field(b,n),ty,pos);return p;}
            case TK::Function:
                if(same(part(a),part(b)))return pairEvidence(Evidence::Function,part(a),join(part(a,true),part(b,true),t.b,pos));
                if(entails(a,{},type,pos)&&entails(b,{},type,pos))return {};
                fail(pos,"joining different callable preconditions needs a common explicit contract","E_REFINEMENT_JOIN");
            default:return {};
        }
    }
    Ranges arithmetic(std::string_view op,const Ranges& a,const Ranges& b) {
        if(a.empty()||b.empty())return {};
        if(a.parts.size()*b.parts.size()>256)return Ranges::all();
        Ranges result;
        for(auto x:a.parts)for(auto y:b.parts) {
            __int128 lo=MIN,hi=MAX;
            if(op=="+"){lo=__int128(x.lo)+y.lo;hi=__int128(x.hi)+y.hi;}
            else if(op=="-"){lo=__int128(x.lo)-y.hi;hi=__int128(x.hi)-y.lo;}
            else if(op=="*") {
                __int128 v[]={__int128(x.lo)*y.lo,__int128(x.lo)*y.hi,__int128(x.hi)*y.lo,__int128(x.hi)*y.hi};
                lo=*std::min_element(v,v+4);hi=*std::max_element(v,v+4);
            } else if(op=="/"&&y.lo==y.hi&&y.lo!=0) {
                __int128 p=__int128(x.lo)/y.lo,q=__int128(x.hi)/y.lo;lo=std::min(p,q);hi=std::max(p,q);
            } else if(op=="%"&&y.lo==y.hi&&y.lo!=0) {
                __int128 n=y.lo;if(n<0)n=-n;lo=-n+1;hi=n-1;
            }
            // Widen conservatively when a transfer could overflow. Runtime operations trap.
            if(lo<MIN||hi>MAX)return Ranges::all();
            result=Ranges::unite(std::move(result),Ranges::span(static_cast<int64_t>(lo),static_cast<int64_t>(hi)));
        }
        return result;
    }
    using Changes=std::vector<std::pair<Id,P>>;
    void assume(Id id,bool truth,Changes& changes) {
        Depth guard(depth,ast.nodes[id].pos);auto& e=ast.nodes[id];
        if(e.kind==EK::Bool){if(bool(e.number)!=truth)unreachable=true;return;}
        if(e.kind==EK::Unary&&e.text=="!"){assume(e.a,!truth,changes);return;}
        if(e.kind!=EK::Binary)return;
        if((e.text=="&&"&&truth)||(e.text=="||"&&!truth)){assume(e.a,truth,changes);assume(e.b,truth,changes);return;}
        if(e.text!="=="&&e.text!="!="&&e.text!="<"&&e.text!="<="&&e.text!=">"&&e.text!=">=")return;
        auto* v=&ast.nodes[e.a];auto* n=&ast.nodes[e.b];std::string op=e.text;
        if(v->kind==EK::Int&&n->kind==EK::Var){std::swap(v,n);if(op=="<")op=">";else if(op=="<=")op=">=";else if(op==">")op="<";else if(op==">=")op="<=";}
        if(v->kind!=EK::Var||n->kind!=EK::Int)return;
        auto r=comparison(op,n->number);if(!truth)r=Ranges::complement(r);
        changes.push_back({v->binder,env.at(v->binder)});
        r=Ranges::intersect(ranges(env[v->binder]),r);if(r.empty())unreachable=true;
        env[v->binder]=intEvidence(std::move(r));
    }
    void restore(const Changes& c){for(auto i=c.rbegin();i!=c.rend();++i)env[i->first]=i->second;}
    P expression(Id id,P expected={},bool checking=false) {
        Depth guard(depth,ast.nodes[id].pos);step(ast.nodes[id].pos);
        if(unreachable)return bottomEvidence();
        auto& e=ast.nodes[id];P out;
        switch(e.kind) {
            case EK::Int:out=intEvidence(Ranges::one(e.number));break;
            case EK::Bool:case EK::Text:case EK::Unit:break;
            case EK::Var:out=env.at(e.binder);break;
            case EK::Lambda:{
                P domain=e.annotation?evidence(e.annotation):(checking?part(expected):P{});
                env[e.binder]=domain;
                P result=expression(e.a,checking?part(expected,true):P{},checking);
                out=pairEvidence(Evidence::Function,domain,result);break;
            }
            case EK::Call:{
                P f=expression(e.a);P a=expression(e.b,part(f),true);
                auto ft=types.nodes[types.find(ast.nodes[e.a].type)];
                require(a,part(f),ft.a,e.pos);out=part(f,true);break;
            }
            case EK::Record:{auto p=std::make_shared<Evidence>();p->kind=Evidence::Record;for(auto [n,x]:e.fields)p->fields[n]=expression(x,field(expected,n),checking);out=p;break;}
            case EK::Field:out=field(expression(e.a),e.name);break;
            case EK::Array:{P elem=bottomEvidence();Id ty=types.nodes[types.find(e.type)].a;for(Id x:e.items)elem=join(elem,expression(x,part(expected),checking),ty,e.pos);out=pairEvidence(Evidence::Array,elem);break;}
            case EK::Unary:{auto a=expression(e.a);if(e.text=="-")out=intEvidence(arithmetic("-",Ranges::one(0),ranges(a)));break;}
            case EK::Binary:{
                auto a=expression(e.a);P b;
                if(e.text=="&&"||e.text=="||") {
                    Changes changes;bool old=unreachable;assume(e.a,e.text=="&&",changes);b=expression(e.b);restore(changes);unreachable=old;
                } else b=expression(e.b);
                if(e.text=="+"||e.text=="-"||e.text=="*"||e.text=="/"||e.text=="%")out=intEvidence(arithmetic(e.text,ranges(a),ranges(b)));
                break;
            }
            case EK::If:{
                expression(e.a);Changes changes;bool old=unreachable;
                assume(e.a,true,changes);auto a=expression(e.b,expected,checking);restore(changes);changes.clear();unreachable=old;
                assume(e.a,false,changes);auto b=expression(e.c,expected,checking);restore(changes);unreachable=old;
                out=join(a,b,e.type,e.pos);break;
            }
            case EK::Block:{
                for(auto& b:e.bindings){P required=b.annotation?evidence(b.annotation):P{};P value=expression(b.expr,required,bool(b.annotation));env[b.binder]=b.annotation?required:value;}
                out=expression(e.a,expected,checking);break;
            }
        }
        if(checking)require(out,expected,e.type,e.pos);
        return out;
    }
public:
    Refine(Ast& a,Types& t,const Infer& inference):ast(a),types(t),env(inference.bindingCount()) {
        for(auto& b:inference.builtins)if(b.name=="length"||b.name=="textLength")env[b.binder]=pairEvidence(Evidence::Function,{},intEvidence(Ranges::span(0,MAX)));
    }
    P run(){return expression(ast.root);}
};
} // namespace tt
