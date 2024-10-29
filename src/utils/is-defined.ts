export const isDefined = <T>(a: T | undefined | null): a is T => {
  return typeof a !== 'undefined' && a !== null;
};

export const removeUndefineds = <T>(a: Optional<T>[]): T[] => {
  const newArray: T[] = [];
  for (const item of a) {
    if (isDefined(item)) {
      newArray.push(item);
    }
  }
  return newArray;
};
