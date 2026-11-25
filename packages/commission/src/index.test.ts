// Every example from the High Tech plan document (sections 2 and 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RATES, directRateBp, splitCommission, totalOf, egp } from "./index.ts";

const R = DEFAULT_RATES.retail;
const W = DEFAULT_RATES.wholesale;
const pct = (bp: number) => bp / 100;

test("retail table: direct share by number of people above the buyer", () => {
  assert.equal(pct(directRateBp(1, R)), 30);
  assert.equal(pct(directRateBp(2, R)), 25);
  assert.equal(pct(directRateBp(3, R)), 20);
  assert.equal(pct(directRateBp(4, R)), 15);
  assert.equal(pct(directRateBp(5, R)), 10);
  assert.equal(pct(directRateBp(6, R)), 10);
  assert.equal(pct(directRateBp(50, R)), 10);
});

test("retail table: everyone above the direct owner gets 5% until the floor, total always 30%", () => {
  for (let n = 1; n <= 30; n++) {
    const upline = Array.from({ length: n }, (_, i) => i);
    const shares = splitCommission(upline, egp(1000), R);
    assert.equal(shares.length, n);
    if (n >= 2 && n <= 5) for (const s of shares.slice(1)) assert.equal(s.rateBp, 500);
    const sumBp = shares.reduce((a, s) => a + s.rateBp, 0);
    assert.ok(Math.abs(sumBp - 3000) < 1e-9, `n=${n} total ${sumBp}`);
  }
});

test("retail example: «4.1» buys for 1,000 EGP → 3.1 gets 100, 2.1/1.1/أ1/م. خالد get 50 each, total 300", () => {
  const upline = ["3.1", "2.1", "1.1", "أ1", "م. خالد"]; // from the direct link owner up
  const shares = splitCommission(upline, egp(1000), R);
  assert.deepEqual(
    shares.map((s) => [s.memberId, s.amount]),
    [["3.1", egp(100)], ["2.1", egp(50)], ["1.1", egp(50)], ["أ1", egp(50)], ["م. خالد", egp(50)]],
  );
  assert.equal(totalOf(shares), egp(300));
});

test("retail example: 11 people above → direct 100, each of the 10 above 20 (200 ÷ 10)", () => {
  const upline = Array.from({ length: 11 }, (_, i) => `m${i}`);
  const shares = splitCommission(upline, egp(1000), R);
  assert.equal(shares[0].amount, egp(100));
  for (const s of shares.slice(1)) assert.equal(s.amount, egp(20));
  assert.equal(totalOf(shares), egp(300));
});

test("retail: buyer with nobody above earns nobody anything", () => {
  assert.deepEqual(splitCommission([], egp(1000), R), []);
});

test("wholesale table: 5% → 4% → 3% fixed, 1% each above, 5% total", () => {
  assert.equal(pct(directRateBp(1, W)), 5);
  assert.equal(pct(directRateBp(2, W)), 4);
  assert.equal(pct(directRateBp(3, W)), 3);
  assert.equal(pct(directRateBp(4, W)), 3);
  assert.equal(pct(directRateBp(20, W)), 3);
  const s2 = splitCommission(["م", "1"], egp(10000), W);
  assert.deepEqual(s2.map((s) => s.amount), [egp(400), egp(100)]);
});

test("wholesale example: invoice 10,000 EGP", () => {
  // one shop above
  assert.deepEqual(splitCommission(["A"], egp(10000), W).map((s) => s.amount), [egp(500)]);
  // three shops above: direct 300, the two above 100 each
  assert.deepEqual(splitCommission(["A", "B", "C"], egp(10000), W).map((s) => s.amount), [egp(300), egp(100), egp(100)]);
  // six shops above: direct 300, the five above 40 each
  assert.deepEqual(
    splitCommission(["A", "B", "C", "D", "E", "F"], egp(10000), W).map((s) => s.amount),
    [egp(300), egp(40), egp(40), egp(40), egp(40), egp(40)],
  );
});

test("never distributes more than the total, even with awkward splits", () => {
  for (const amount of [1, 7, 99, 12345, 999999]) {
    for (let n = 1; n <= 15; n++) {
      const upline = Array.from({ length: n }, (_, i) => i);
      for (const rates of [R, W]) {
        const t = totalOf(splitCommission(upline, amount, rates));
        assert.ok(t <= Math.floor((amount * rates.totalBp) / 10000), `amount=${amount} n=${n}`);
      }
    }
  }
});

test("custom rates from the dashboard are respected and validated", () => {
  const custom = { totalBp: 2000, stepBp: 400, floorBp: 800 };
  const s = splitCommission(["a", "b", "c", "d"], egp(1000), custom);
  assert.deepEqual(s.map((x) => x.amount), [egp(80), egp(40), egp(40), egp(40)]);
  assert.throws(() => splitCommission(["a"], 100, { totalBp: 100, stepBp: 10, floorBp: 200 }));
  assert.throws(() => splitCommission(["a"], 1.5, R));
});
