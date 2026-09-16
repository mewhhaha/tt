#include "pipeline.hpp"
int main(int argc,char** argv) {
    std::string source,path;
    try {
        if(argc<3){std::cerr<<"usage: tt check|run SOURCE [--metrics]\n       tt build SOURCE -o OUTPUT.ttbc\n       tt exec ARTIFACT.ttbc\n";return 2;}
        std::string command=argv[1];path=argv[2];
        if(command=="exec") {
            if(argc!=3)tt::fail(0,"unexpected arguments","E_USAGE");
            auto data=tt::readFile(path,64*1024*1024);auto p=tt::decode(std::vector<uint8_t>(data.begin(),data.end()));
            std::cout<<tt::display(tt::VM(p).run(),p)<<"\n";return 0;
        }
        if(command!="check"&&command!="run"&&command!="build")tt::fail(0,"unknown command","E_USAGE");
        bool metrics=argc==4&&std::string(argv[3])=="--metrics";
        if(command=="build") {if(argc!=5||std::string(argv[3])!="-o")tt::fail(0,"build requires -o OUTPUT","E_USAGE");}
        else if(argc!=3&&!metrics)tt::fail(0,"unexpected arguments","E_USAGE");
        source=tt::readFile(path);auto c=tt::compile(source,command!="check");
        if(command=="build")tt::writeFile(argv[4],tt::encode(c.program));
        else if(command=="run")std::cout<<tt::display(tt::VM(c.program).run(),c.program)<<"\n";
        else std::cout<<c.type<<"\n";
        if(metrics)std::cerr<<tt::metricsJson(c)<<"\n";
        return 0;
    } catch(const tt::Error& e) {
        size_t line=1,column=1;
        for(size_t i=0;i<std::min(e.pos,source.size());++i){if(source[i]=='\n'){++line;column=1;}else ++column;}
        std::cerr<<path<<":"<<line<<":"<<column<<": "<<e.code<<": "<<e.what()<<"\n";return 1;
    } catch(const std::bad_alloc&) {std::cerr<<"E_LIMIT: allocation failed\n";return 1;}
    catch(const std::exception& e){std::cerr<<"E_INTERNAL: "<<e.what()<<"\n";return 1;}
}
