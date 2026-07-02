describe("Test environment", () => {
  test("should have QIVRYN_GLOBAL_DIR env var set to .qivryn-test", () => {
    expect(process.env.QIVRYN_GLOBAL_DIR).toBeDefined();
    expect(process.env.QIVRYN_GLOBAL_DIR)?.toMatch(/\.qivryn-test$/);
  });
});
