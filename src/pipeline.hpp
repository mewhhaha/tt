#pragma once
#include "bytecode.hpp"
#include <cerrno>
#include <unistd.h>
namespace tt {
using Clock=std::chrono::steady_clock;
inline double elapsed(Clock::time_point a){return std::chrono::duration<double,std::milli>(Clock::now()-a).count();}
struct Compilation { Program program;Metrics metrics;size_t astNodes=0,typeNodes=0;std::string type; };
inline Compilation compile(std::string_view source,bool emitCode=true) {
    auto start=Clock::now();auto ast=Parser(source).parse();double parse=elapsed(start);
    Types types;Infer inference(ast,types);start=Clock::now();Id type=inference.run();double checking=elapsed(start);
    start=Clock::now();Refine(ast,types,inference).run();double proof=elapsed(start);
    Compilation result;result.astNodes=ast.nodes.size();result.typeNodes=types.nodes.size();
    if(emitCode){start=Clock::now();result.program=Emit(ast,inference).run();validate(result.program);result.metrics.emitMs=elapsed(start);}
    double emit=result.metrics.emitMs;result.metrics=types.metrics;result.metrics.parseMs=parse;result.metrics.typeMs=checking;result.metrics.refineMs=proof;result.metrics.emitMs=emit;
    result.type=types.show(type,ast.symbols);return result;
}
inline std::string readFile(const std::string& path,size_t maximum=4*1024*1024) {
    std::ifstream file(path,std::ios::binary);if(!file)fail(0,"cannot open '"+path+"'","E_IO");
    file.seekg(0,std::ios::end);auto size=file.tellg();if(size<0||uint64_t(size)>maximum)fail(0,"input file size limit exceeded","E_LIMIT");
    file.seekg(0);std::string result(static_cast<size_t>(size),'\0');if(!result.empty()&&!file.read(result.data(),size))fail(0,"cannot read input","E_IO");return result;
}
inline void writeFile(const std::string& path,const std::vector<uint8_t>& bytes) {
    // Unique same-directory temporary: concurrent writers cannot share a staging file.
    std::string pattern=path+".tmp.XXXXXX";
    std::vector<char> name(pattern.begin(),pattern.end());name.push_back('\0');
    int fd=::mkstemp(name.data());
    if(fd<0)fail(0,"cannot create temporary output","E_IO");
    struct Cleanup {
        int fd;const char* path;
        ~Cleanup(){if(fd>=0)::close(fd);::unlink(path);}
    } cleanup{fd,name.data()};
    size_t at=0;
    while(at<bytes.size()) {
        auto written=::write(fd,bytes.data()+at,bytes.size()-at);
        if(written<0&&errno==EINTR)continue;
        if(written<=0)fail(0,"cannot write output","E_IO");
        at+=static_cast<size_t>(written);
    }
    int closed=::close(fd);cleanup.fd=-1;
    if(closed!=0)fail(0,"cannot close output","E_IO");
    std::error_code ec;std::filesystem::rename(name.data(),path,ec);
    if(ec)fail(0,"cannot replace output: "+ec.message(),"E_IO");
}
inline std::string metricsJson(const Compilation& c) {
    std::ostringstream s;auto& m=c.metrics;
    s<<"{\"parse_ms\":"<<m.parseMs<<",\"type_ms\":"<<m.typeMs<<",\"refine_ms\":"<<m.refineMs<<",\"emit_ms\":"<<m.emitMs
     <<",\"ast_nodes\":"<<c.astNodes<<",\"type_nodes\":"<<c.typeNodes<<",\"unify_steps\":"<<m.unify<<",\"occurs_visits\":"<<m.occurs
     <<",\"instantiate_visits\":"<<m.instantiate<<",\"generalize_visits\":"<<m.generalize<<",\"projection_steps\":"<<m.projections<<",\"proof_steps\":"<<m.proof<<"}";return s.str();
}
} // namespace tt
