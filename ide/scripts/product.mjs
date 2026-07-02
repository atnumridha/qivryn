export function applyProductOverlay(product, overlay) {
  const result = structuredClone(product);

  for (const key of overlay.remove) {
    delete result[key];
  }
  Object.assign(result, overlay.set);

  return result;
}

export function assertProductOverlay(product, overlay) {
  for (const [key, expected] of Object.entries(overlay.set)) {
    if (JSON.stringify(product[key]) !== JSON.stringify(expected)) {
      throw new Error(
        `product.json field ${key} does not match the Qivryn overlay`,
      );
    }
  }

  for (const key of overlay.remove) {
    if (key in product) {
      throw new Error(`product.json still contains removed key ${key}`);
    }
  }
}
