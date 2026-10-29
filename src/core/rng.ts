/**
 * 确定性随机数生成器（xorshift32）
 * 为什么不用 Math.random：世界要能"用种子复现"，存档也要能存 RNG 状态。
 */
export class Rng {
  s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }

  /** [0, n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** [a, b) 浮点 */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** [a, b] 整数 */
  intRange(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 正态近似（Box-Muller 简化版），均值 0 标准差 1 */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}
