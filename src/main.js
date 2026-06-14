function initializeApp() {
  const memoryModel = new MemoryModel();
  const memoryVisualizer = new Visualizer();

  initController(memoryModel, memoryVisualizer);
}

initializeApp();
