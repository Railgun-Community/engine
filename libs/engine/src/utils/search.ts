export const binarySearchForUpperBoundIndex = <T>(array: T[], pred: (a: T) => boolean): number => {
  let l = 0;
  let r = array.length;
  while (l < r) {
    const mid = l + ((r - l) >> 1);
    if (pred(array[mid])) {
      l = mid + 1;
    } else {
      r = mid;
    }
  }
  return l - 1;
};
