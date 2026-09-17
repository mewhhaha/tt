# Executable surface, revision 0.4

Every module ends in `return expression;`. Bindings and fields use semicolons.
Indentation is cosmetic. Comments start with `//`.

```blot
const Positive = Int where self > 0;       // currently a type alias only
const Small = Int where self >= 0 && self <= 100;
const Both = Positive & Small;
const Nonzero = Int where self != 0;
const Row = { .x: Int; .name: Text; };

let identity = fn x => x;
let add = fn x => fn y => x + y;
let narrow = fn (x :: Positive) => x;
let checked :: Small -> Int = fn x => x + 1;
let update = fn record => do {
    let x = record.x + 1;
    return { .x = x; .name = record.name; };
};
return map update [{ .x = 41; .name = "answer"; }];
```

Types: `Int`, `Bool`, `Text`, `Unit`, `[T]`, `A -> B`, record requirements, and
previously defined type aliases. Arrows associate right. In this initial parser,
`&` and `|` have equal precedence and associate left; parenthesize mixed formulas.
Parenthesize a refined domain as needed before `->`.

Values: decimal signed-64-bit literals, `true`, `false`, strings, `()`, homogeneous
arrays, records, functions, application, field selection, `do { ... }`, and
`if condition then yes else no`. A negative argument needs parentheses (`f (-1)`)
because `f - 1` means subtraction. There is no tuple syntax; use a record.

Operators from low to high precedence: `||`, `&&`, `== !=`, `< <= > >=`, `+ -`,
`* / %`, application, field selection. Unary `-` and `!` are prefix forms.
Comparison/equality operations currently accept Int, not a hidden overload search.
Strings support `\n`, `\r`, `\t`, `\\`, and `\"`. Text length counts bytes.

Initial primitives:

    length     : [a] -> Int
    get        : [a] -> Int -> a             // checked; traps out of bounds
    map        : (a -> b) -> [a] -> [b]
    fold       : (a -> b -> a) -> a -> [b] -> a
    concat     : Text -> Text -> Text
    textLength : Text -> Int

Function and row variables in displayed inferred types are compiler-generated.
Explicit universal quantification, recursion, variants, tags, mutation/ownership,
and arbitrary const computations are not in this revision.

## Modules and synchronous operations

```text
let Library = import "./library.tt";
effect Read :: Unit -> Int;
let reader :: Unit -> Int ~ {Read} = fn ignored => Read ();
return handle Read with (fn ignored => 42) in reader ();
```

Imports must be top-level let initializers and imported modules return export records.
`host Read` constructs an explicitly delegated host operation; it grants no capability
by itself. Handler/host selectors can project statically known imported operations.
Closed arrow rows currently name preceding local declarations only. See
[MODULES_EFFECTS.md](MODULES_EFFECTS.md) for exact initialization, handler, higher-order
and host-boundary semantics. There is no continuation capture/resume or async syntax.
