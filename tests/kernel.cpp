#include "../src/pipeline.hpp"
#include <random>

static void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static bool contains(const tt::Ranges& r,int64_t x){for(auto p:r.parts)if(p.lo<=x&&x<=p.hi)return true;return false;}
static void rejects(const std::function<void()>& f,const std::string& code) {
    try { f(); } catch(const tt::Error& e){check(e.code==code,"wrong diagnostic category");return;}
    throw std::runtime_error("expected rejection");
}
int main() {
    try {
        size_t checks=0;
        for(int64_t a=-5;a<=5;++a)for(int64_t b=a;b<=5;++b)
        for(int64_t c=-5;c<=5;++c)for(int64_t d=c;d<=5;++d) {
            auto x=tt::Ranges::span(a,b),y=tt::Ranges::span(c,d);
            auto u=tt::Ranges::unite(x,y),i=tt::Ranges::intersect(x,y),n=tt::Ranges::complement(x);
            check(tt::Ranges::unite(x,x)==x,"union idempotence");
            check(tt::Ranges::intersect(x,x)==x,"intersection idempotence");
            auto reverse=tt::Ranges::unite(y,x);
            check(u==reverse,"union commutativity");
            check(tt::Ranges::complement(n)==x,"double complement");
            for(int64_t v=-6;v<=6;++v) {
                check(contains(u,v)==(contains(x,v)||contains(y,v)),"union meaning");
                check(contains(i,v)==(contains(x,v)&&contains(y,v)),"intersection meaning");
                check(contains(n,v)!=contains(x,v),"complement meaning");checks+=3;
            }
            check(x.subset(y)==(a>=c&&b<=d),"subset meaning");checks+=5;
        }
        for(int64_t n:{tt::MIN,tt::MIN+1,int64_t(-1),int64_t(0),int64_t(1),tt::MAX-1,tt::MAX}) {
            check(!contains(tt::comparison("!=",n),n),"nonzero hole at boundary");
            check(tt::Ranges::complement(tt::Ranges::one(n))==tt::comparison("!=",n),"boundary complement");
            for(int64_t v:{tt::MIN,int64_t(-1),int64_t(0),int64_t(1),tt::MAX}) {
                check(contains(tt::comparison("<",n),v)==(v<n),"less at boundary");
                check(contains(tt::comparison(">",n),v)==(v>n),"greater at boundary");checks+=2;
            }
            checks+=2;
        }
        {
            tt::Types t;auto row=t.fresh(1,true);auto one=t.record({{0,t.integer}},row);
            auto two=t.record({{0,t.integer},{1,t.boolean}});t.unify(one,two,0);
            check(t.find(t.project(one,1,1,0))==t.boolean,"open row projection");
            auto v=t.fresh(1);rejects([&]{t.unify(v,t.array(v),0);},"E_TYPE");
            auto tail=t.fresh(1,true);auto left=t.row({{0,t.integer}},tail),right=t.row({{1,t.boolean}},tail);
            rejects([&]{t.unify(left,right,0);},"E_TYPE");checks+=3;
        }
        {
            auto c=tt::compile("return 42;");auto bytes=tt::encode(c.program);
            auto restored=tt::decode(bytes);tt::VM vm(restored);check(vm.run().number==42,"artifact round trip");
            auto bad=c.program;bad.functions[0].code={{tt::Op::Return}};
            rejects([&]{tt::validate(bad);},"E_BYTECODE");
            bad=c.program;bad.functions[0].code[0]={tt::Op::Jump,999999};
            rejects([&]{tt::validate(bad);},"E_BYTECODE");
            bad=c.program;bad.functions[0].code[0]={tt::Op::Local,1};
            rejects([&]{tt::validate(bad);},"E_BYTECODE");
            bad=c.program;bad.functions[0].locals=1;bad.functions[0].code={{tt::Op::Local,0},{tt::Op::Return}};
            tt::validate(bad);rejects([&]{tt::VM(bad).run();},"E_RUNTIME");++checks;
            bad=c.program;bad.functions[0].code={{tt::Op::Jump,0}};
            tt::validate(bad);rejects([&]{tt::VM(bad,100).run();},"E_LIMIT");checks+=5;
        }
        std::cout<<checks<<" kernel property checks passed\n";
    } catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
