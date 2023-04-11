export const averageNumber = (array: number[]) => {
  return array.reduce((a, b) => a + b) / array.length;
};
