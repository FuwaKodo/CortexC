export const TYPE_SIZES = {
  int: 4,
  char: 1,
  float: 4,
  double: 8,
  void: 0,
  long: 8,
  short: 2,
};

export class MemoryModel {
  constructor() {
    this.stack = []
    this.heap = new Map();
    this.globals = new Map();
    this.nextHeapAddr = 0x4000;
    this.nextGlobalAddr = 0x1000;
    this.nextStackBase = 0x7FF0;
  }
}