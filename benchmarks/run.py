#!/usr/bin/env python3
"""Record reproducible in-process compiler measurements; deterministic work gates."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess

ROOT=Path(__file__).resolve().parents[1]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--binary',type=Path,default=Path('build/tt-bench'))
    p.add_argument('--output',type=Path,default=Path('benchmarks/local.json'))
    p.add_argument('--samples',type=int,default=11)
    p.add_argument('--sizes',type=int,nargs='+',default=[500,1000,2000])
    args=p.parse_args();binary=args.binary.resolve()
    files=sorted([ROOT/'CMakeLists.txt',*ROOT.glob('src/*.hpp'),ROOT/'src/main.cpp',ROOT/'benchmarks/bench.cpp',Path(__file__).resolve()])
    before={str(f.relative_to(ROOT)):sha(f) for f in files}
    binary_before=sha(binary)
    reports=[]
    for size in args.sizes:
        run=subprocess.run([str(binary),str(size),str(args.samples)],capture_output=True,text=True,check=True,timeout=120)
        report=json.loads(run.stdout)
        for item in report['workloads']:
            work=item['work']
            # These are bounded-work regression tests, not proofs of global complexity.
            assert work['type_nodes']<=16*size+100,(item['name'],'type node growth')
            assert work['instantiate_visits']<=12*size+100,(item['name'],'instantiation growth')
            assert work['proof_steps']<=50*size+200,(item['name'],'proof work growth')
            if item['name']=='records':
                assert work['projection_steps']==size
                assert work['instantiate_visits']==0
            raw=sorted(item['raw_ms'])
            assert len(raw)==args.samples
            assert abs(raw[len(raw)//2]-item['median_ms'])<0.0001
        reports.append(report)
    after={str(f.relative_to(ROOT)):sha(f) for f in files}
    if before!=after or binary_before!=sha(binary):raise RuntimeError('inputs changed during measurement')
    cache=binary.parent/'CMakeCache.txt'
    flags=[line for line in cache.read_text().splitlines() if line.startswith(('CMAKE_CXX_COMPILER:','CMAKE_BUILD_TYPE:','CMAKE_CXX_FLAGS'))] if cache.exists() else []
    cpu='unknown'
    if Path('/proc/cpuinfo').exists():
        cpu=next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),'unknown')
    compiler=next((line.split('=',1)[1] for line in flags if line.startswith('CMAKE_CXX_COMPILER:')),'c++')
    toolchain=subprocess.run([compiler,'--version'],capture_output=True,text=True,check=True).stdout
    result={'compiler_version':toolchain,'schema':1,'recorded_at':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),'machine':platform.machine(),'cpu':cpu,'logical_cpus':os.cpu_count(),'python':platform.python_version(),'compiler_build_settings':flags,'binary_sha256':binary_before,'source_sha256':before,'reports':reports,'claims':'Local in-process compiler timings, not cold-process latency, runtime speed, or production qualification. Shared-host wall times are observations; deterministic work gates are enforced.'}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
    for report in reports:
        print(report['size'],', '.join(f"{w['name']}={w['median_ms']:.3f} ms" for w in report['workloads']))
if __name__=='__main__':main()
