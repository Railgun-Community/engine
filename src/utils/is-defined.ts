export const isDefined = <T>(a: T | undefined | null): a is T => {
  return typeof a !== 'undefined' && a !== null;
};

export const removeUndefineds = <T>(a: Optional<T>[]): T[] => {
  const newArray: T[] = [];
  a.forEach((item) => {
    if (isDefined(item)) {
      newArray.push(item);
    }
  });
  return newArray;
};
