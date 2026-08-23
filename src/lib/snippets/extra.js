/**
 * Snippet library — supplemental snippets for Go, Rust, Kotlin, and Swift.
 * Code typing supports them fully; two entries per difficulty.
 */

export const EXTRA_SNIPPETS = {
  go: [
    { difficulty: 'easy', title: 'Hello, world', topic: 'program structure', intro: 'Package, import, func main — the whole ceremony.', code: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, TypeForge")\n}` },
    { difficulty: 'easy', title: 'Range over a slice', topic: 'slices', intro: 'Discards the index with the blank identifier.', code: `func total(nums []int) int {\n\tsum := 0\n\tfor _, n := range nums {\n\t\tsum += n\n\t}\n\treturn sum\n}` },

    { difficulty: 'normal', title: 'Error wrapping', topic: 'errors', intro: 'Adds context with %w so callers can still unwrap the cause.', code: `func load(path string) ([]byte, error) {\n\tb, err := os.ReadFile(path)\n\tif err != nil {\n\t\treturn nil, fmt.Errorf("load %s: %w", path, err)\n\t}\n\treturn b, nil\n}` },
    { difficulty: 'normal', title: 'Worker pool', topic: 'goroutines', intro: 'Fan-out over a channel with a WaitGroup to know when it is done.', code: `func run(jobs <-chan int, out chan<- int, wg *sync.WaitGroup) {\n\tdefer wg.Done()\n\tfor j := range jobs {\n\t\tout <- j * j\n\t}\n}` },

    { difficulty: 'hard', title: 'Context with timeout', topic: 'context', intro: 'Races real work against a deadline and always cancels.', code: `ctx, cancel := context.WithTimeout(ctx, 2*time.Second)\ndefer cancel()\n\nselect {\ncase res := <-work:\n\treturn res, nil\ncase <-ctx.Done():\n\treturn nil, ctx.Err()\n}` },
    { difficulty: 'hard', title: 'Table-driven test', topic: 'testing', intro: 'The idiomatic Go test shape: a slice of cases, one subtest each.', code: `func TestAbs(t *testing.T) {\n\tcases := []struct {\n\t\tin, want int\n\t}{{-2, 2}, {0, 0}, {3, 3}}\n\n\tfor _, c := range cases {\n\t\tif got := Abs(c.in); got != c.want {\n\t\t\tt.Errorf("Abs(%d) = %d, want %d", c.in, got, c.want)\n\t\t}\n\t}\n}` },

    { difficulty: 'expert', title: 'Interface satisfaction', topic: 'interfaces', intro: 'A compile-time assertion that the type implements the interface.', code: `type Store interface {\n\tGet(id string) (*User, error)\n\tPut(u *User) error\n}\n\nvar _ Store = (*memStore)(nil)` },
    { difficulty: 'expert', title: 'Generic constraint', topic: 'generics', intro: 'One Map for every element type, bounded by a type set.', code: `type Number interface {\n\t~int | ~int64 | ~float64\n}\n\nfunc Map[T, U any](in []T, f func(T) U) []U {\n\tout := make([]U, 0, len(in))\n\tfor _, v := range in {\n\t\tout = append(out, f(v))\n\t}\n\treturn out\n}` },
  ],

  rust: [
    { difficulty: 'easy', title: 'Hello, world', topic: 'program structure', intro: 'println! is a macro, which is why it has the bang.', code: `fn main() {\n    println!("Hello, TypeForge");\n}` },
    { difficulty: 'easy', title: 'Option handling', topic: 'options', intro: 'Returns a borrowed slice that might not exist.', code: `fn first_word(s: &str) -> Option<&str> {\n    s.split_whitespace().next()\n}` },

    { difficulty: 'normal', title: 'Result with ?', topic: 'errors', intro: 'The question mark propagates the error without a match block.', code: `fn parse_port(raw: &str) -> Result<u16, ParseIntError> {\n    let port = raw.trim().parse::<u16>()?;\n    Ok(port)\n}` },
    { difficulty: 'normal', title: 'Struct with impl', topic: 'structs', intro: 'Associated function for construction, method for behaviour.', code: `struct Counter {\n    value: u32,\n}\n\nimpl Counter {\n    fn new() -> Self {\n        Self { value: 0 }\n    }\n\n    fn bump(&mut self) -> u32 {\n        self.value += 1;\n        self.value\n    }\n}` },

    { difficulty: 'hard', title: 'Iterator chain', topic: 'iterators', intro: 'Lazy adapters fused into a single pass by the compiler.', code: `let total: u32 = items\n    .iter()\n    .filter(|i| i.active)\n    .map(|i| i.score)\n    .sum();` },
    { difficulty: 'hard', title: 'Pattern matching', topic: 'enums', intro: 'Exhaustive match over an enum with data in every arm.', code: `enum Event {\n    Click { x: i32, y: i32 },\n    Key(char),\n    Close,\n}\n\nfn describe(e: &Event) -> String {\n    match e {\n        Event::Click { x, y } => format!("click {x},{y}"),\n        Event::Key(c) => format!("key {c}"),\n        Event::Close => "close".to_string(),\n    }\n}` },

    { difficulty: 'expert', title: 'Trait with default', topic: 'traits', intro: 'A default method built on top of the one required method.', code: `trait Summary {\n    fn author(&self) -> String;\n\n    fn preview(&self) -> String {\n        format!("Read more from {}...", self.author())\n    }\n}` },
    { difficulty: 'expert', title: 'Lifetime annotation', topic: 'lifetimes', intro: 'Tells the compiler the result borrows from the longer-lived input.', code: `fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {\n    if a.len() > b.len() {\n        a\n    } else {\n        b\n    }\n}` },
  ],

  kotlin: [
    { difficulty: 'easy', title: 'Data class', topic: 'data classes', intro: 'equals, hashCode, copy and toString for free.', code: `data class User(\n    val id: String,\n    val name: String,\n    val active: Boolean = true,\n)` },
    { difficulty: 'easy', title: 'Null safety', topic: 'nullability', intro: 'Safe call plus Elvis operator instead of a null check.', code: `fun displayName(user: User?): String =\n    user?.name?.takeIf { it.isNotBlank() } ?: "Anonymous"` },

    { difficulty: 'normal', title: 'Scope functions', topic: 'idioms', intro: 'apply configures, also side-effects, both return the receiver.', code: `val config = Config().apply {\n    host = "localhost"\n    port = 8080\n}.also { println(it) }` },
    { difficulty: 'normal', title: 'Extension function', topic: 'extensions', intro: 'Adds a method to a type you do not own.', code: `fun String.slugify(): String =\n    lowercase()\n        .replace(Regex("[^a-z0-9]+"), "-")\n        .trim('-')` },

    { difficulty: 'hard', title: 'Sealed hierarchy', topic: 'sealed classes', intro: 'A closed set of states that when can match exhaustively.', code: `sealed interface State {\n    data object Loading : State\n    data class Ready(val items: List<Item>) : State\n    data class Failed(val cause: Throwable) : State\n}` },
    { difficulty: 'hard', title: 'Delegated property', topic: 'delegates', intro: 'Computes once on first access, then caches.', code: `class Report(private val rows: List<Row>) {\n    val summary: String by lazy {\n        rows.joinToString { it.label }\n    }\n}` },

    { difficulty: 'expert', title: 'Flow operator', topic: 'coroutines', intro: 'Debounces keystrokes and cancels the previous search.', code: `fun search(query: Flow<String>): Flow<List<Hit>> =\n    query\n        .debounce(300)\n        .distinctUntilChanged()\n        .flatMapLatest { repo.search(it) }` },
    { difficulty: 'expert', title: 'Inline reified', topic: 'generics', intro: 'reified keeps the type at runtime, which erasure normally removes.', code: `inline fun <reified T> Json.decode(raw: String): T =\n    decodeFromString(serializer<T>(), raw)` },
  ],

  swift: [
    { difficulty: 'easy', title: 'Optional binding', topic: 'optionals', intro: 'guard let exits early and keeps the happy path unindented.', code: `func greet(_ name: String?) -> String {\n    guard let name else { return "Hello, stranger" }\n    return "Hello, \\(name)"\n}` },
    { difficulty: 'easy', title: 'Struct with computed property', topic: 'structs', intro: 'Value semantics plus a property derived on read.', code: `struct Rect {\n    var width: Double\n    var height: Double\n\n    var area: Double {\n        width * height\n    }\n}` },

    { difficulty: 'normal', title: 'Codable model', topic: 'codable', intro: 'Maps a snake_case API field onto a Swift property name.', code: `struct Repo: Codable {\n    let id: Int\n    let name: String\n    let stars: Int\n\n    enum CodingKeys: String, CodingKey {\n        case id, name, stars = "stargazers_count"\n    }\n}` },
    { difficulty: 'normal', title: 'Enum with associated values', topic: 'enums', intro: 'A result type modelled directly in the type system.', code: `enum Loadable<T> {\n    case idle\n    case loading\n    case loaded(T)\n    case failed(Error)\n}` },

    { difficulty: 'hard', title: 'Protocol extension', topic: 'protocols', intro: 'Gives every conforming type a shared default implementation.', code: `protocol Identifiable {\n    var id: String { get }\n}\n\nextension Identifiable {\n    var shortID: String { String(id.prefix(7)) }\n}` },
    { difficulty: 'hard', title: 'Result builder usage', topic: 'DSLs', intro: 'The declarative shape SwiftUI is built on.', code: `var body: some View {\n    VStack(alignment: .leading, spacing: 8) {\n        Text(title).font(.headline)\n        if let subtitle {\n            Text(subtitle).foregroundStyle(.secondary)\n        }\n    }\n}` },

    { difficulty: 'expert', title: 'Async task group', topic: 'concurrency', intro: 'Runs fetches in parallel and collects them as they finish.', code: `func load() async throws -> [Item] {\n    try await withThrowingTaskGroup(of: Item.self) { group in\n        for id in ids { group.addTask { try await fetch(id) } }\n        return try await group.reduce(into: []) { $0.append($1) }\n    }\n}` },
    { difficulty: 'expert', title: 'Actor for shared state', topic: 'concurrency', intro: 'Serialises access so the counter cannot race.', code: `actor Counter {\n    private var value = 0\n\n    func increment() -> Int {\n        value += 1\n        return value\n    }\n}` },
  ],
};
