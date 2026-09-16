#include "../src/pipeline.hpp"
#include <iomanip>
#include <numeric>

static std::string workload(const std::string& name,size_t n) {
    std::string s;
    if(name=="wrappers") {
        s="let f0=fn x=>x;\n";
        for(size_t i=1;i<=n;++i)s+="let f"+std::to_string(i)+"=fn x=>f"+std::to_string(i-1)+" x;\n";
        return s+"return f"+std::to_string(n)+" 42;\n";
    }
    if(name=="records") {
        s="let r={ ";for(size_t i=0;i<n;++i)s+=".f"+std::to_string(i)+"="+std::to_string(i)+";";
        s+="};\n";
        for(size_t i=0;i<n;++i)s+="let x"+std::to_string(i)+"=r.f"+std::to_string(i)+";\n";
        return s+"return x"+std::to_string(n-1)+";\n";
    }
    if(name=="polymorphism") {
        s="let id=fn x=>x; let getX=fn r=>r.x;\n";
        for(size_t i=0;i<n;++i)s+="let x"+std::to_string(i)+"=id (getX { .x="+std::to_string(i)+"; .tag=true; });\n";
        return s+"return x"+std::to_string(n-1)+";\n";
    }
    if(name=="refinements") {
        s="const Small=Int where self>=0 && self<100; const Pos=Int where self>0; let f :: Small -> Pos=fn x=>x+1;\n";
        for(size_t i=0;i<n;++i)s+="let x"+std::to_string(i)+" :: Pos=f "+std::to_string(i%100)+";\n";
        return s+"return x"+std::to_string(n-1)+";\n";
    }
    throw std::runtime_error("unknown workload");
}
int main(int argc,char** argv) {
    try {
        size_t n=argc>1?std::stoull(argv[1]):1000;unsigned samples=argc>2?static_cast<unsigned>(std::stoul(argv[2])):9;
        if(n==0||n>10000||samples<3||samples>100)throw std::runtime_error("use size 1..10000 and samples 3..100");
        std::cout<<"{\"schema\":1,\"size\":"<<n<<",\"samples\":"<<samples<<",\"boundary\":\"in-process parse+infer+refine+emit+validate; includes destruction; excludes input generation and artifact encoding\",\"workloads\":[";
        bool first=true;
        for(auto name:{"wrappers","records","polymorphism","refinements"}) {
            // Independent expected result checked on a small equivalent workload before timing.
            auto small=tt::compile(workload(name,20));auto got=tt::VM(small.program).run();
            int64_t expected=std::string(name)=="wrappers"?42:(std::string(name)=="refinements"?20:19);
            if(got.kind!=tt::Value::Int||got.number!=expected)throw std::runtime_error("semantic parity failure");
            auto source=workload(name,n);std::vector<double> times;
            for(unsigned i=0;i<2;++i){auto c=tt::compile(source);(void)c;}
            static volatile size_t observed=0;
            for(unsigned i=0;i<samples;++i) {
                auto start=tt::Clock::now();
                {auto c=tt::compile(source);observed=c.typeNodes+c.program.functions.size();}
                times.push_back(tt::elapsed(start));
            }
            (void)observed;
            auto facts=tt::compile(source); // Untimed counters, no retained-result timing asymmetry.
            auto sorted=times;std::sort(sorted.begin(),sorted.end());
            if(!first)std::cout<<",";first=false;
            std::cout<<"{\"name\":\""<<name<<"\",\"source_bytes\":"<<source.size()<<",\"median_ms\":"<<sorted[sorted.size()/2]<<",\"raw_ms\":[";
            for(size_t i=0;i<times.size();++i){if(i)std::cout<<",";std::cout<<times[i];}
            std::cout<<"],\"work\":"<<tt::metricsJson(facts)<<"}";
        }
        std::cout<<"]}\n";
    } catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
