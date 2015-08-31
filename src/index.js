import isGeneratorFunction from "is-generator-function";
import isIterable from "is-iterable";
import isIteratorLike from "is-iterator-like";

function isGen(v) {
  if (regeneratorRuntime) {
    /* global regeneratorRuntime */
    return regeneratorRuntime.isGeneratorFunction(v);
  }
  return isGeneratorFunction(v);
}

export class Stream {
  /**
   * A {@link Stream} is a structure containing a reference to a string, and a positional
   * index into that string. Three operations are permitted on it: reading the character
   * at the current index, testing whether you are at the end of the string, and
   * creating a new {@link Stream} pointing at the next index.
   *
   * The rationale between using a {@link Stream} structure instead of passing along a
   * string containing the remaining input is, of course, performance. A string slice
   * operation needs linear time to perform, whereas {@link Stream#next} runs in constant
   * time. Because you pass along only a reference to the same input string, memory usage
   * is also close to constant.
   * @arg {string} buffer
   * @arg {number} cursor
   */
  constructor(buffer, cursor) {
    this.buffer = buffer;
    this.cursor = typeof cursor === "number" ? cursor : 0;
    Object.freeze(this);
  }

  /**
   * Get the character at the position represented by this {@link Stream}.
   */
  get() {
    if (this.atEnd()) {
      throw new Error("Cannot step past end of buffer.");
    }
    return this.buffer[this.cursor];
  }

  /**
   * Create a {@link Stream} pointing at the next character position.
   */
  next() {
    if (this.atEnd()) {
      throw new Error("Cannot step past end of buffer.");
    }
    return new Stream(this.buffer, this.cursor + 1);
  }

  /**
   * Return `true` if this {@link Stream} is pointing to the end of the input.
   */
  atEnd() {
    return this.cursor >= this.buffer.length;
  }
}

export class ParseError {
  /**
   * A {@link ParseError} signals a failed parse operation, and holds the {@link Stream}
   * position at which the parser failed, along with an optional error message.
   * @arg {Stream} input
   * @arg {string} message
   */
  constructor(input, message) {
    this.input = input;
    this.message = message;
    Object.freeze(this);
  }
}

export class ParseResult {
  /**
   * A {@link ParseResult} holds the result of a successful parse operation. It contains
   * the value which was parsed, a {@link Stream} pointing to the remaining unconsumed
   * input, and some useful metadata.
   * @arg {any} value - The value which this parse operation produced.
   * @arg {Stream} next - The position if the remainder of the input stream.
   * @arg {Stream} start - The position at which this parser began parsing.
   * @arg {string} matched - The exact string this parser consumed.
   */
  constructor(value, next, start, matched) {
    this.value = value;
    this.next = next;
    this.start = start;
    this.matched = matched;
    Object.freeze(this);
  }
}

export function error(input, message) {
  return new ParseError(input, message);
}

export function result(value, next, start, matched) {
  return new ParseResult(value, next, start, matched);
}

/**
 * Create a {@link Stream} from a string.
 * @arg {string} s
 */
export function stream(s) {
  return new Stream(s);
}



/**
 * Perform a parse operation.
 * @arg {Parser} parser - The parser to run.
 * @arg {Stream} input - The input to run the parser on.
 */
export function parse(parser, input) {
  return parser(input);
}



function badValue(v) {
  return new Error(`Parser returned unexpected value: ${v}`);
}



/**
 * The {@link seq} combinator takes a parser, and a function which will receive the
 * result of that parser if it succeeds, and which should return another parser, which
 * will be run immediately after the initial parser. In this way, you can join parsers
 * together in a sequence, producing more complex parsers.
 *
 * Alternatively, you can pass a single generator function, which should yield parsers,
 * and which will receive back the {@link ParseResult}s resulting from running those
 * parsers on the input in sequence. If one of these parsers fails, the sequence stops
 * there. After parsing, you should `return` the value resulting from the parse
 * operation.
 *
 * @arg {(Parser|GeneratorFunction)} parser
 * @arg {?function(any): Parser} callback
 */
export function seq(parser, callback) {
  if (isGen(parser)) {
    return (start) => {
      const iter = parser();
      const runP = (input, res) => {
        const next = iter.next(res !== undefined ? res : null);
        if (next.done) {
          return result(next.value, input, res.start, res.matched);
        }
        const out = parse(next.value, input);
        if (out instanceof ParseResult) {
          const matched = res === undefined ? out.matched : res.matched + out.matched;
          return runP(out.next, result(out.value, out.next, start, matched));
        }
        if (out instanceof ParseError) {
          return out;
        }
        throw badValue(out);
      };
      return runP(start);
    };
  }

  return (input) => {
    const out = parse(parser, input);
    if (out instanceof ParseResult) {
      const next = parse(callback(out.value, input), out.next);
      if (next instanceof ParseResult) {
        return result(next.value, next.next, input, out.matched + next.matched);
      }
      if (next instanceof ParseError) {
        return next;
      }
      throw badValue(next);
    }
    if (out instanceof ParseError) {
      return out;
    }
    throw badValue(out);
  };
}

/**
 * The {@link either} combinator takes two parsers, runs the first on the input stream,
 * and if that fails, it will proceed to trying the second parser on the same stream.
 * Basically, try parser 1, then try parser 2.
 *
 * Instead of two parsers, you can pass any iterable or iterator containing parsers,
 * which will then be attempted on the input stream in order until one succeeds.
 *
 * @arg {(Parser|Iterator|Iterable)} p1
 * @arg {?Parser} p2
 */
export function either(p1, p2) {
  if (isGen(p1)) {
    return either(p1());
  }
  if (isIteratorLike(p1)) {
    const {value, done} = p1.next();
    return done ? value : either(value, either(p1));
  }
  if (isIterable(p1)) {
    return either(p1[Symbol.iterator]());
  }
  return (input) => {
    const r1 = parse(p1, input);
    if (r1 instanceof ParseResult) {
      return r1;
    }
    if (r1 instanceof ParseError) {
      const r2 = parse(p2, input);
      if (r2 instanceof ParseResult || r2 instanceof ParseError) {
        return r2;
      }
      throw badValue(r2);
    }
    throw badValue(r1);
  };
}

/**
 * The {@link unit} parser constructor creates a parser which will simply return the
 * value provided as its argument, without consuming any input.
 *
 * It is particularly useful at the end of a {@link seq} chain.
 *
 * @arg {any} value
 * @arg {?string} matched - You can provide a value for the matched string to go in the
 *                          {@link ParseResult} here. This is usually not necessary.
 */
export function unit(value, matched = "") {
  return (input) => result(value, input, input, matched);
}

/**
 * The {@link fail} parser will just immediately without consuming any input.
 */
export function fail(input) {
  return error(input);
}

/**
 * The {@link item} parser consumes a single character, regardless of what it is, and
 * returns it as its result.
 */
export function item(input) {
  return input.atEnd() ? error(input) : result(input.get(), input.next(), input, input.get());
}

/**
 * The {@link sat} parser constructor takes a predicate function, and will consume a
 * single character if calling that predicate function with the character as its argument
 * returns `true`. If it returns `false`, the parser will fail.
 * @arg {function(string): boolean} predicate
 */
export function sat(predicate) {
  return seq(item, (value, start) => predicate(value) ? unit(value) : () => fail(start));
}

/**
 * The {@link maybe} parser combinator creates a parser which will run the provided
 * parser on the input, and if it fails, it will return the empty string as a result,
 * without consuming input.
 * @arg {Parser} parser
 */
export function maybe(parser) {
  return either(parser, unit(""));
}



/**
 * The {@link manyA} combinator takes a parser, and returns a new parser which will
 * run the parser repeatedly on the input stream until it fails, returning an array
 * of the result values of each parse operation as its result. This array may be
 * empty.
 * @arg {Parser} parser
 */
export function manyA(parser) {
  return either(many1(parser), unit([]));
}

/**
 * The {@link many1A} combinator is just like the {@link manyA} combinator, except it
 * requires its wrapped parser to match at least once. The result array is thus
 * guaranteed to contain at least one value.
 * @arg {Parser} parser
 */
export function many1A(parser) {
  return seq(parser, (head) => seq(many(parser), (tail) => unit([head, ...tail])));
}



/**
 * The {@link many} combinator takes a parser which must return a string value, and
 * returns a new parser which will match the input parser zero or more times, returning
 * the complete matched string. This string may be empty.
 * @arg {Parser} parser
 */
export function many(parser) {
  return maybe(many1(parser));
}

/**
 * The {@link many1} combinator is just like the {@link many} combinator, except it
 * requires its wrapped parser to match at least once. The result string is thus
 * guaranteed to be non-empty.
 * @arg {Parser} parser
 */
export function many1(parser) {
  return seq(parser, (head) => seq(many(parser), (tail) => unit(head + tail)));
}



/**
 * The {@link char} parser constructor returns a parser which matches only the specified
 * single character.
 * @arg {string} c - The character this parser will match.
 */
export function char(c) {
  return sat((i) => i === c);
}

/**
 * The {@link notChar} parser constructor makes a parser which will match any single
 * character which is not the one provided.
 * @arg {string} c - The character this parser won't match.
 */
export function notChar(c) {
  return sat((i) => i !== c);
}

/**
 * The {@link string} parser constructor builds a parser which matches the exact string
 * provided.
 * @arg {string} s - The string to match.
 */
export function string(s) {
  if (s.length > 0) {
    return seq(char(s[0]), () => seq(string(s.slice(1)), () => unit(s)));
  }
  return unit("");
}



export const isDigit = (c) => /^\d$/.test(c);
export const isSpace = (c) => /^\s$/.test(c);
export const isAlphanum = (c) => /^\w$/.test(c);
export const isLetter = (c) => /^[a-zA-Z]$/.test(c);
export const isUpper = (c) => isLetter(c) && c == c.toUpperCase();
export const isLower = (c) => isLetter(c) && c == c.toLowerCase();
export const not = (f) => (c) => !f(c);

export const digit = sat(isDigit);
export const space = sat(isSpace);
export const alphanum = sat(isAlphanum);
export const letter = sat(isLetter);
export const upper = sat(isUpper);
export const lower = sat(isLower);

export const notDigit = sat(not(isDigit));
export const notSpace = sat(not(isSpace));
export const notAlphanum = sat(not(isAlphanum));
export const notLetter = sat(not(isLetter));
export const notUpper = sat(not(isUpper));
export const notLower = sat(not(isLower));

export const spaces = many(space);
export const spaces1 = many1(space);

export const notSpaces = many(sat(not(isSpace)));
export const notSpaces1 = many1(sat(not(isSpace)));



export function str([head, ...tail]) {
  return tail.length ? seq(head, (v) => seq(str(tail), (vs) => unit(v + vs))) : head;
}



export const int = seq(function*() {
  const r = yield str([
    maybe(char("-")),
    many1(digit)
  ]);
  const n = parseInt(r.value, 10);
  if (isNaN(n)) {
    yield fail;
  }
  return n;
});

export const float = seq(function*() {
  const r = yield str([
    maybe(char("-")),
    many(digit),
    maybe(str([char("."), many1(digit)]))
  ]);
  const n = parseFloat(r.value);
  if (isNaN(n)) {
    yield fail;
  }
  return n;
});

export const quotedString = seq(function*() {
  yield char("\"");
  const {value: s} = yield many(either(
    seq(char("\\"), () => item),
    notChar("\"")
  ));
  yield char("\"");
  return s;
});
