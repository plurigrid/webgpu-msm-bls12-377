jest.setTimeout(10000000);

import assert from "assert";
import seedrandom from "seedrandom";
import {
  to_words_le,
  from_words_le,
  calc_num_words,
  compute_mont_radix,
  compute_mont_constants,
} from "../../implementation/cuzk/utils";

const num_inputs = 1000;

const rng = seedrandom("hello");
const rand = () => {
  return rng();
};

const do_tests = (desc: string, p: bigint) => {
  describe(desc, () => {
    const p_width = p.toString(2).length;
    const params: any = {};
    const inputs: any = {};

    beforeAll(() => {
      for (let word_size = 12; word_size < 16; word_size++) {
        const num_words = calc_num_words(word_size, p_width);
        const r = compute_mont_radix(num_words, word_size);
        const { n0, rinv } = compute_mont_constants(p, r, word_size);
        const nsafe = Math.ceil(2 ** 32 / 2 ** (word_size * 2)) / 2;
        params[word_size] = {
          p_words: to_words_le(p, num_words, word_size),
          num_words,
          n0,
          r,
          nsafe,
          rinv,
        };

        inputs[word_size] = [];
        for (let i = 0; i < num_inputs; i++) {
          const x = BigInt(
            "0x8ab655e9adca556d0b44dee5c37b001e9aa76eed20000310a118a3303448e89",
          );
          const a =
            (BigInt(Math.floor(rand() * ((i + 1) * 23453454353235))) * x) % p;
          const b =
            (BigInt(Math.floor(rand() * ((i + 1) * 93923490235483))) * x) % p;
          const ar = (a * r) % p;
          const br = (b * r) % p;
          const ar_words = to_words_le(ar, num_words, word_size);
          const br_words = to_words_le(br, num_words, word_size);
          inputs[word_size].push({
            a,
            b,
            ar,
            br,
            ar_words,
            br_words,
          });
        }
      }
    });

    it("test if inputs can be greater than p (13-bit words)", () => {
      const word_size = 13;
      const { num_words, n0, r, p_words } = params[word_size];

      for (let i = 0; i < inputs[word_size].length; i ++) {
        const { a, b, ar, br, ar_words, br_words } = inputs[word_size][i]
        const arp = ar + p
        const brp = br + p
        const arp_words = to_words_le(arp, num_words, word_size)
        const brp_words = to_words_le(arp, num_words, word_size)

        expect(from_words_le(arp_words, num_words, word_size) === arp)
        expect(from_words_le(brp_words, num_words, word_size) === brp)

        const expected_mod_p = BigInt(a * b * r) % BigInt(p)
        const expected_mod_p_words = to_words_le(expected_mod_p, num_words, word_size)

        const product_0 = mont_optimised(
          ar_words,
          br_words,
          p_words,
          num_words,
          word_size,
          n0,
        );
        const product_1 = mont_optimised(
          arp_words,
          brp_words,
          p_words,
          num_words,
          word_size,
          n0,
        );

        expect(product_0).toEqual(expected_mod_p_words)

        // montgomery_product(ar + p, br + p) does not give a correct result
        expect(product_1.toString()).not.toEqual(expected_mod_p_words.toString())

        // Even reducing the result does not give the expected value
        const product_1_mod_p = from_words_le(product_1, num_words, word_size) % p
        expect(product_1_mod_p).not.toEqual(expected_mod_p)
      }
    })

    it("iterative algo for 12 to 15-bit words", () => {
      for (let word_size = 13; word_size < 14; word_size++) {
        const { num_words, n0, r, p_words } = params[word_size];
        for (const input of inputs[word_size]) {
          const { a, b, ar_words, br_words } = input;
          const expected_abr = BigInt(a * b * r) % p;

          // mont_iterative should work
          const result_words = mont_iterative(
            ar_words,
            br_words,
            p_words,
            num_words,
            word_size,
            n0,
          );
          const result = from_words_le(result_words, num_words, word_size);
          expect(expected_abr.toString()).toEqual(result.toString());
        }
      }
    });

    it("algos for 12-bit words", () => {
      const word_size = 12;
      const { num_words, n0, r, p_words } = params[word_size];

      for (const input of inputs[word_size]) {
        const { a, b, ar_words, br_words } = input;
        const expected_abr = BigInt(a * b * r) % p;

        // mont_optimised should work
        const result_optimised_words = mont_optimised(
          ar_words,
          br_words,
          p_words,
          num_words,
          word_size,
          n0,
        );
        const result_optimised = from_words_le(
          result_optimised_words,
          num_words,
          word_size,
        );
        expect(expected_abr.toString()).toEqual(result_optimised.toString());

        // mont_optimised_test_overflow should not throw an error
        mont_optimised_test_overflow(num_words, word_size);
      }
    });

    it("algos for 13-bit words", () => {
      const word_size = 13;
      const { num_words, n0, r, p_words } = params[word_size];

      for (const input of inputs[word_size]) {
        const { a, b, ar_words, br_words } = input;
        const expected_abr = BigInt(a * b * r) % p;

        // mont_optimised should work
        const result_optimised_words = mont_optimised(
          ar_words,
          br_words,
          p_words,
          num_words,
          word_size,
          n0,
        );
        const result_optimised = from_words_le(
          result_optimised_words,
          num_words,
          word_size,
        );
        expect(expected_abr.toString()).toEqual(result_optimised.toString());

        // mont_optimised_test_overflow should not throw an error
        mont_optimised_test_overflow(num_words, word_size);
      }
    });

    it("algos for 14-bit words", () => {
      const word_size = 14;
      const { num_words, n0, r, p_words, nsafe } = params[word_size];

      for (const input of inputs[word_size]) {
        const { a, b, ar_words, br_words } = input;
        const expected_abr = BigInt(a * b * r) % p;

        // mont_modified should work
        const result_modified_words = mont_modified(
          ar_words,
          br_words,
          p_words,
          num_words,
          word_size,
          n0,
          nsafe,
        );
        const result_modified = from_words_le(
          result_modified_words,
          num_words,
          word_size,
        );
        expect(expected_abr.toString()).toEqual(result_modified.toString());
      }

      // mont_optimised_test_overflow should throw an error
      expect(() =>
        mont_optimised_test_overflow(num_words, word_size),
      ).toThrow();
    });

    it("algos for 15-bit words", () => {
      const word_size = 15;
      const { num_words, n0, r, p_words, nsafe } = params[word_size];

      for (const input of inputs[word_size]) {
        const { a, b, ar_words, br_words } = input;
        const expected_abr = BigInt(a * b * r) % p;

        // mont_modified should work
        const result_modified_words = mont_modified(
          ar_words,
          br_words,
          p_words,
          num_words,
          word_size,
          n0,
          nsafe,
        );
        const result_modified =
          from_words_le(result_modified_words, num_words, word_size) % p;
        expect(expected_abr.toString()).toEqual(result_modified.toString());
      }

      // mont_optimised_test_overflow should throw an error
      expect(() =>
        mont_optimised_test_overflow(num_words, word_size),
      ).toThrow();
    });
  });
};

describe("Montgomery multiplication algorithms", () => {
  do_tests(
    "for the 253-bit field",
    BigInt(
      "0x12ab655e9a2ca55660b44d1e5c37b00159aa76fed00000010a11800000000001",
    ),
  );
  do_tests(
    "for the 377-bit field",
    BigInt(
      "0x01ae3a4617c510eac63b05c06ca1493b1a22d9f300f5138f1ef3622fba094800170b5d44300000008508c00000000001",
    ),
  );
});

// Suitable for all word sizes below 16
const mont_iterative = (
  x: Uint16Array,
  y: Uint16Array,
  p: Uint16Array,
  num_words: number,
  word_size: number,
  n0: number,
) => {
  const lo_mask = 2 ** word_size - 1;

  const s = Array(num_words).fill(0);
  for (let i = 0; i < num_words; i++) {
    const t = machine_add(s[0], machine_mul(x[i], y[0]));

    const t_prime = lo(t, lo_mask);
    const qi = lo(machine_mul(n0, t_prime), lo_mask);
    let c = hi(machine_add(t, machine_mul(qi, p[0])), word_size);

    for (let j = 1; j < num_words; j++) {
      const t = machine_add(
        machine_add(s[j], machine_mul(x[i], y[j])),
        machine_add(machine_mul(qi, p[j]), c),
      );
      c = hi(t, word_size);
      s[j - 1] = lo(t, lo_mask);
    }
    s[num_words - 1] = c;
  }

  // Conditional reduction
  const v = from_words_le(new Uint16Array(s), num_words, word_size);
  const p_b = from_words_le(p, num_words, word_size);
  if (v > p_b) {
    return to_words_le(v % p_b, num_words, word_size);
  }
  return new Uint16Array(s);
};

const hi = (val: number, word_size: number) => {
  return Number(BigInt(val) >> BigInt(word_size));
};

const lo = (val: number, lo_mask: number) => {
  return Number(BigInt(val) & BigInt(lo_mask));
};

// Suitable for cases when nSafe is less than num_words
const mont_modified = (
  x: Uint16Array,
  y: Uint16Array,
  p: Uint16Array,
  num_words: number,
  word_size: number,
  n0: number,
  nsafe: number,
) => {
  const lo_mask = 2 ** word_size - 1;

  const s = Array(num_words).fill(0);

  for (let i = 0; i < num_words; i++) {
    let t = machine_add(s[0], machine_mul(x[i], y[0]));
    const tprime = lo(t, lo_mask);
    const qi = lo(machine_mul(n0, tprime), lo_mask);
    let c = hi(machine_add(t, machine_mul(qi, p[0])), word_size);

    for (let j = 1; j < num_words - 1; j++) {
      t = machine_add(
        machine_add(s[j], machine_mul(x[i], y[j])),
        machine_mul(qi, p[j]),
      );

      if ((j - 1) % nsafe === 0) {
        t += c;
      }

      if (j % nsafe === 0) {
        c = hi(t, word_size);
        s[j - 1] = lo(t, lo_mask);
      } else {
        s[j - 1] = t;
      }
    }

    if ((num_words - 2) % nsafe === 0) {
      const v = machine_add(
        machine_add(s[num_words - 1], machine_mul(x[i], y[num_words - 1])),
        machine_mul(qi, p[num_words - 1]),
      );
      c = hi(v, word_size);
      s[num_words - 2] = lo(v, lo_mask);
      s[num_words - 1] = c;
    } else {
      s[num_words - 2] = machine_add(
        machine_mul(x[i], y[num_words - 1]),
        machine_mul(qi, p[num_words - 1]),
      );
    }
  }

  let c = 0;
  for (let i = 0; i < num_words; i++) {
    const v = machine_add(s[i], c);
    c = hi(v, word_size);
    s[i] = lo(v, lo_mask);
  }

  // Conditional reduction
  const v = from_words_le(new Uint16Array(s), num_words, word_size);
  const p_b = from_words_le(p, num_words, word_size);
  if (v > p_b) {
    return to_words_le(v % p_b, num_words, word_size);
  }
  return new Uint16Array(s);
};

// Suitable for word sizes 12 and 13 as their nSafe values are larger than
// num_words
const mont_optimised = (
  x: Uint16Array,
  y: Uint16Array,
  p: Uint16Array,
  num_words: number,
  word_size: number,
  n0: number,
) => {
  //assert(word_size === 13 || word_size === 12)

  const lo_mask = 2 ** word_size - 1;

  const s = Array(num_words).fill(0);
  for (let i = 0; i < num_words; i++) {
    const t = machine_add(s[0], machine_mul(x[i], y[0]));

    const t_prime = lo(t, lo_mask);
    const qi = lo(machine_mul(n0, t_prime), lo_mask);
    const c = hi(machine_add(t, machine_mul(qi, p[0])), word_size);

    // Add with carry
    s[0] = machine_add(
      machine_add(s[1], machine_mul(x[i], y[1])),
      machine_add(machine_mul(qi, p[1]), c),
    );

    // Skip the carry, assuming that for the given word_size and num_words,
    // no value in s[] will exceed 2 ** 32.
    for (let j = 2; j < num_words; j++) {
      s[j - 1] = machine_add(
        machine_add(s[j], machine_mul(x[i], y[j])),
        machine_mul(qi, p[j]),
      );
    }

    s[num_words - 2] = machine_add(
      machine_mul(x[i], y[num_words - 1]),
      machine_mul(qi, p[num_words - 1]),
    );
  }

  // Final round of carries
  let c = 0;
  for (let i = 0; i < num_words; i++) {
    const r = machine_add(s[i], c);
    c = hi(r, word_size);
    s[i] = lo(r, lo_mask);
  }

  // Conditional reduction
  const v = from_words_le(new Uint16Array(s), num_words, word_size);
  const p_b = from_words_le(p, num_words, word_size);
  if (v > p_b) {
    return to_words_le(v % p_b, num_words, word_size);
  }
  return new Uint16Array(s);
};

const mont_optimised_test_overflow = (num_words: number, word_size: number) => {
  const s = Array(num_words).fill(0);
  for (let i = 0; i < num_words; i++) {
    const max = 2 ** word_size - 1;
    s[0] = max;

    // Skip the carry
    for (let j = 2; j < num_words; j++) {
      const t = s[j] + max * max + max * max;
      s[j - 1] = t;
      assert(t < 2 ** 32, "overflow detected");
    }
  }
};

const machine_add = (x: number, y: number, machine_word_size = 2 ** 32) => {
  return (x + y) % machine_word_size;
};

const machine_mul = (x: number, y: number, machine_word_size = 2 ** 32) => {
  return (x * y) % machine_word_size;
};

export {};
