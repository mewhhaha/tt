#!/usr/bin/env python3
"""End-to-end acceptance, rejection, artifact, and differential regression tests."""
import json
import os
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile
import unittest

BINARY = str(Path(sys.argv.pop(1)).resolve()) if len(sys.argv)>1 else str(Path('build/tt').resolve())
POS = 'const Pos = Int where self > 0; '

class CompilerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def command(self,*args):
        return subprocess.run([BINARY,*map(str,args)],text=True,capture_output=True,timeout=10)
    def source(self,text,name='input.tt'):
        path=self.root/name;path.write_text(text);return path
    def accept(self,text,expected=None):
        p=self.source(text)
        check=self.command('check',p)
        self.assertEqual(check.returncode,0,check.stderr+'\n'+text)
        if expected is not None:
            run=self.command('run',p)
            self.assertEqual(run.returncode,0,run.stderr+'\n'+text)
            self.assertEqual(run.stdout.strip(),expected,text)
            out=self.root/'out.ttbc'
            built=self.command('build',p,'-o',out)
            self.assertEqual(built.returncode,0,built.stderr)
            run=self.command('exec',out)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertEqual(run.stdout.strip(),expected)
        return check.stdout.strip()
    def reject(self,text,code='E_TYPE'):
        result=self.command('check',self.source(text))
        self.assertNotEqual(result.returncode,0,text)
        self.assertIn(code,result.stderr,text+'\n'+result.stderr)
    def test_repository_examples(self):
        examples = Path(__file__).resolve().parents[1] / 'examples'
        expected = {
            'refinements.tt': '42',
            'higher_order.tt': '12',
            'branch_proofs.tt': '[0, 0, 42]',
            'records.tt': '[{ .position = 13; .name = "first"; }, { .position = 23; .name = "second"; }]',
        }
        self.assertEqual({p.name for p in examples.glob('*.tt')}, set(expected))
        for name, result in expected.items():
            with self.subTest(example=name):
                self.accept((examples / name).read_text(), result)

    def test_readme_program(self):
        readme = (Path(__file__).resolve().parents[1] / 'README.md').read_text()
        program = readme.split('```blot\n', 1)[1].split('```', 1)[0]
        self.accept(program, '42')

    def test_primitives(self):
        for text,want in [('return 42;','42'),('return true;','true'),('return ();','()'),('return "a\\n\\"b";','"a\\n\\"b"'),('return -9223372036854775808;','-9223372036854775808')]:
            with self.subTest(text=text):self.accept(text,want)
    def test_precedence(self):
        self.accept('return 2 + 3 * 4 - 5;', '9')
        self.accept('let f = fn x => x + 1; return f 3 * 2;', '8')
    def test_polymorphic_identity(self):
        self.accept('let id = fn x => x; let a = id 42; let b = id true; return { .a=a; .b=b; };','{ .a = 42; .b = true; }')
    def test_monomorphic_parameter(self):
        self.reject('let bad = fn f => { .a=f 1; .b=f true; }; return bad;')
    def test_let_generalization_does_not_generalize_captures(self):
        self.reject('let bad = fn x => do { let y = x; let a = y 1; return y true; }; return bad;')
    def test_infinite_type(self):
        self.reject('return fn x => x x;')
    def test_row_polymorphism(self):
        self.accept('let getX = fn r => r.x; let a=getX { .x=42; .y=true; }; let b=getX { .x=false; }; return { .a=a; .b=b; };','{ .a = 42; .b = false; }')
    def test_combined_field_requirements(self):
        self.accept('let sum = fn r => r.x+r.y; return sum { .z=true; .y=2; .x=40; };','42')
        self.reject('let sum = fn r => r.x+r.y; return sum { .x=1; };')
    def test_record_order_independent(self):
        self.accept('let f = fn x => if true then { .a=x; .b=2; } else { .b=3; .a=x; }; return (f 40).a;','40')
    def test_nested_record_projection(self):
        self.accept('let f = fn r => r.a.b; return f { .a={ .b=42; .c=false; }; };','42')
    def test_closure_capture(self):
        self.accept('let make = fn n => fn x => n+x; let a=make 10; let b=make 20; return a 1 + b 2;','33')
    def test_shadowing_preserves_lexical_binding(self):
        self.accept('let x=10; let f=fn ignored => x; let x=20; return f () + x;','30')
    def test_nested_local_closure(self):
        self.accept('let make=fn x => do { let y=x+1; return fn z => y+z; }; return make 40 1;','42')
    def test_higher_order_composition(self):
        self.accept('let compose=fn f => fn g => fn x => f (g x); let inc=fn x => x+1; return compose inc inc 40;','42')
    def test_arrays_map_fold(self):
        self.accept('let xs=map (fn x => x*2) [1,2,3]; return fold (fn a => fn b => a+b) 0 xs;','12')
    def test_empty_array_polymorphism(self):
        self.accept('let xs=[]; let a=map (fn x => x+1) xs; let b=map (fn x => !x) xs; return length a + length b;','0')
    def test_array_heterogeneity_rejected(self):
        self.reject('return [1,true];')
    def test_native_currying_and_text(self):
        self.accept('let hi=concat "hello "; return hi "world";','"hello world"')
        self.accept('return textLength "abc";','3')
    def test_refinement_good_bad(self):
        self.accept(POS+'let x :: Pos = 42; return x;','42')
        self.reject(POS+'let x :: Pos = 0; return x;','E_REFINEMENT')
    def test_refined_function(self):
        self.accept(POS+'const Small=Int where self >= 0 && self < 100; let inc :: Small -> Pos = fn x => x+1; return inc 41;','42')
        self.reject(POS+'let inc :: Int -> Pos = fn x => x+1; return inc;','E_REFINEMENT')
    def test_refined_call(self):
        self.reject(POS+'let f :: Pos -> Int = fn x => x; return f 0;','E_REFINEMENT')
    def test_parameter_annotation(self):
        self.accept(POS+'let f=fn (x :: Pos) => x; return f 42;','42')
        self.reject(POS+'let f=fn (x :: Pos) => x; return f 0;','E_REFINEMENT')
    def test_nonzero_disjunction(self):
        self.accept('const NZ=Int where self != 0; let f :: NZ -> Int = fn x => 42/x; return f (-2);','-21')
        self.reject('const NZ=Int where self != 0; let x :: NZ=0; return x;','E_REFINEMENT')
    def test_type_union_and_intersection(self):
        self.accept('const A=Int where self >= 0 && self <= 10; const B=Int where self >= 5 && self <= 20; const C=A & B; let x :: C=7; return x;','7')
        self.reject('const A=Int where self == 1; const B=Int where self == 3; const C=A | B; let x :: C=2; return x;','E_REFINEMENT')
    def test_branch_refinement_true_false(self):
        self.accept(POS+'let f=fn x => if x > 0 then do { let y :: Pos=x; return y; } else 0; return f 42;','42')
        self.accept(POS+'let f=fn x => if x <= 0 then 1 else do { let y :: Pos=x; return y; }; return f 42;','42')
        self.reject(POS+'let f=fn x => if x > 0 then 1 else do { let y :: Pos=x; return y; }; return f;','E_REFINEMENT')
    def test_branch_facts_do_not_leak(self):
        self.reject(POS+'let f=fn x => do { let ignored=if x > 0 then x else 1; let y :: Pos=x; return y; }; return f;','E_REFINEMENT')
    def test_short_circuit_refinement(self):
        self.accept(POS+'let valid :: Pos -> Bool = fn x => true; let f=fn x => x > 0 && valid x; return f 0;','false')
        self.accept('const NZ=Int where self != 0; let f :: NZ -> Bool=fn x=>true; let g=fn x=>x==0 || f x; return g 0;','true')
    def test_short_circuit_runtime(self):
        self.accept('return false && (1/0==1);','false')
        self.accept('return true || (1/0==1);','true')
    def test_unreachable_refinement(self):
        self.accept(POS+'let f=fn x => if x > 0 && x <= 0 then do { let impossible :: Pos=-1; return impossible; } else 42; return f 0;','42')
    def test_record_refinement(self):
        self.accept(POS+'const R={ .x: Pos; }; let r :: R={ .x=42; .name="a"; }; return r.x;','42')
        self.reject(POS+'const R={ .x: Pos; }; let r :: R={ .x=0; }; return r;','E_REFINEMENT')
    def test_array_refinement(self):
        self.accept(POS+'let xs :: [Pos]=[1,2,3]; return length xs;','3')
        self.accept(POS+'let xs :: [Pos]=[]; return length xs;','0')
        self.reject(POS+'let xs :: [Pos]=[1,0]; return xs;','E_REFINEMENT')
    def test_callable_preconditions_not_erased(self):
        prefix=POS+'let narrow :: Pos -> Int = fn x => x; '
        cases=[
            'let broad :: Int -> Int=narrow; return broad 0;',
            'let id=fn x=>x; let broad=id narrow; return broad 0;',
            'let apply=fn f=>f 0; return apply narrow;',
            'let id=fn x=>x; let r=id { .f=narrow; }; return r.f 0;',
            'return get [narrow] 0 0;',
            'return map narrow [0];',
        ]
        for case in cases:
            with self.subTest(case=case):self.reject(prefix+case,'E_REFINEMENT')
    def test_explicit_higher_order_contract(self):
        self.accept(POS+'let call :: (Pos -> Int) -> Int = fn f => f 42; let narrow :: Pos -> Int=fn x=>x; return call narrow;','42')
    def test_callable_contravariance(self):
        self.accept(POS+'let broad :: Int -> Int=fn x=>x; let narrow :: Pos -> Int=broad; return narrow 42;','42')
    def test_inferred_constant_postcondition(self):
        self.accept(POS+'let f=fn x=>1; let result :: Pos=f (); return result;','1')
    def test_callable_join_does_not_erase(self):
        self.reject(POS+'let choose=fn flag => if flag then (fn (x :: Pos) => x) else (fn x => x); return choose;','E_REFINEMENT_JOIN')
    def test_runtime_traps(self):
        for text in ['return 1/0;','return 1%0;','return 9223372036854775807+1;','return -9223372036854775808 / (-1);','return get [1] 5;','return get [1] (-1);']:
            with self.subTest(text=text):
                self.accept(text)
                result=self.command('run',self.source(text))
                self.assertNotEqual(result.returncode,0)
                self.assertIn('E_RUNTIME',result.stderr)
    def test_refinement_overflow_does_not_wrap(self):
        self.reject(POS+'let x :: Pos=9223372036854775807+1; return x;','E_REFINEMENT')
    def test_i64_remainder_boundary(self):
        self.accept('return -9223372036854775808 % (-1);','0')
    def test_syntax_rejections(self):
        for text in ['return 9223372036854775808;','return -9223372036854775809;','return "bad\\z";','return { .x=1; .x=2; };','return "unfinished;','let x = 1 return x;']:
            with self.subTest(text=text):self.reject(text,'E_PARSE')
    def test_unknown_name(self):
        self.reject('return missing;','E_NAME')
    def test_explicit_unsupported_type_logic(self):
        self.reject('const X=Int | Text; return 0;','E_UNSUPPORTED')
    def test_nesting_limit(self):
        self.reject('return '+'('*300+'0'+')'*300+';','E_LIMIT')
    def test_source_limit(self):
        self.reject(' '*(4*1024*1024+1)+'return 0;','E_LIMIT')
    def test_metrics(self):
        r=self.command('check',self.source('return 1;'),'--metrics')
        self.assertEqual(r.returncode,0,r.stderr)
        metrics=json.loads(r.stderr)
        self.assertGreater(metrics['ast_nodes'],0)
        self.assertGreaterEqual(metrics['type_ms'],0)
    def test_deterministic_artifact(self):
        src=self.source('let make=fn a=>fn b=>a+b; return make 40 2;')
        a=self.root/'a.ttbc';b=self.root/'b.ttbc'
        self.assertEqual(self.command('build',src,'-o',a).returncode,0)
        self.assertEqual(self.command('build',src,'-o',b).returncode,0)
        self.assertEqual(a.read_bytes(),b.read_bytes())
    def test_failed_build_preserves_artifact(self):
        out=self.root/'out.ttbc';out.write_bytes(b'previous')
        r=self.command('build',self.source('return missing;'),'-o',out)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(out.read_bytes(),b'previous')
    def test_concurrent_builds_are_atomic(self):
        a=self.source('return 42;','a.tt');b=self.source('return 43;','b.tt');out=self.root/'shared.ttbc'
        left=subprocess.Popen([BINARY,'build',str(a),'-o',str(out)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        right=subprocess.Popen([BINARY,'build',str(b),'-o',str(out)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        _,le=left.communicate(timeout=10);_,re=right.communicate(timeout=10)
        self.assertEqual(left.returncode,0,le);self.assertEqual(right.returncode,0,re)
        run=self.command('exec',out);self.assertEqual(run.returncode,0,run.stderr)
        self.assertIn(run.stdout.strip(),['42','43'])
        self.assertEqual(list(self.root.glob('*.tmp.*')),[])
    def test_failed_rename_cleans_temporary(self):
        out=self.root/'directory';out.mkdir()
        r=self.command('build',self.source('return 42;'),'-o',out)
        self.assertNotEqual(r.returncode,0);self.assertIn('E_IO',r.stderr)
        self.assertTrue(out.is_dir());self.assertEqual(list(self.root.glob('*.tmp.*')),[])
    def test_malformed_artifacts(self):
        for data in [b'',b'TTBC',b'TTBC'+struct.pack('<I',99),b'TTBC'+struct.pack('<II',1,2**32-1)]:
            with self.subTest(data=data):
                p=self.root/'bad.ttbc';p.write_bytes(data);r=self.command('exec',p)
                self.assertNotEqual(r.returncode,0);self.assertIn('E_BYTECODE',r.stderr)
    def test_truncated_and_corrupted_artifact(self):
        p=self.root/'ok.ttbc';self.assertEqual(self.command('build',self.source('return 42;'),'-o',p).returncode,0)
        data=p.read_bytes()
        for end in range(len(data)):
            with self.subTest(end=end):
                q=self.root/'bad.ttbc';q.write_bytes(data[:end]);r=self.command('exec',q)
                self.assertNotEqual(r.returncode,0);self.assertIn('E_BYTECODE',r.stderr)
        q=self.root/'bad.ttbc';q.write_bytes(data+b'garbage');self.assertIn('E_BYTECODE',self.command('exec',q).stderr)
    def test_differential_arithmetic(self):
        rng=random.Random(72021)
        def tree(depth):
            if depth==0:
                n=rng.randrange(-20,21);return '('+str(n)+')',n
            a,av=tree(depth-1);b,bv=tree(depth-1);op=rng.choice(['+','-','*'])
            v=av+bv if op=='+' else av-bv if op=='-' else av*bv
            return '('+a+op+b+')',v
        for i in range(60):
            source,value=tree(3)
            with self.subTest(i=i):self.accept('return '+source+';',str(value))
    def test_differential_refinement_acceptance(self):
        for op in ['<','<=','==','!=','>=','>']:
            for value in range(-4,5):
                ok={'<':value<1,'<=':value<=1,'==':value==1,'!=':value!=1,'>=':value>=1,'>':value>1}[op]
                source=f'const T=Int where self {op} 1; let x :: T={value}; return x;'
                with self.subTest(op=op,value=value):
                    if ok:self.accept(source,str(value))
                    else:self.reject(source,'E_REFINEMENT')
    def test_wrapper_chain(self):
        source='let f0=fn x=>x;'+''.join(f'let f{i}=fn x=>f{i-1} x;' for i in range(1,101))+'return f100 42;'
        self.accept(source,'42')
    def test_fuzz_parser_smoke(self):
        rng=random.Random(741)
        for i in range(80):
            text=''.join(rng.choice('abc012+-{}[]();=><&|" \\') for _ in range(rng.randrange(1,100)))
            r=self.command('check',self.source(text))
            self.assertIn(r.returncode,[0,1],r.stderr)
            self.assertNotIn('E_INTERNAL',r.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
