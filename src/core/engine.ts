/**
 * Engine initialization and management
 * Handles Babylon.js engine setup, canvas, and render loop
 */

import { Engine } from '@babylonjs/core/Engines/engine';

// Maximum delta time to prevent physics instability
const MAX_DELTA_TIME = 1 / 30; // Cap at ~30fps equivalent delta

/**
 * Tests whether the browser supports WebGL by attempting to create a context
 */
function isWebGLSupported(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    return !!(
      testCanvas.getContext('webgl2') || testCanvas.getContext('webgl')
    );
  } catch {
    return false;
  }
}

/**
 * Creates and configures the Babylon.js engine
 */
export function createEngine(canvas: HTMLCanvasElement): Engine {
  if (!isWebGLSupported()) {
    throw new Error(
      'Your browser or device does not support WebGL, which is required to run this game.\n\n' +
        'Try the following:\n' +
        '- Update your browser to the latest version\n' +
        '- Enable hardware acceleration in your browser settings\n' +
        '- Try a different browser (Chrome, Firefox, or Edge)\n' +
        '- Update your graphics drivers'
    );
  }

  // Create engine with antialiasing enabled
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
    powerPreference: 'high-performance',
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    engine.resize();
  });

  return engine;
}

/**
 * Clamps delta time to prevent physics instability at low framerates
 */
export function clampDeltaTime(deltaTime: number): number {
  return Math.min(deltaTime, MAX_DELTA_TIME);
}

/**
 * Starts the render loop with delta time clamping
 */
export function startRenderLoop(
  engine: Engine,
  renderCallback: (deltaTime: number) => void
): void {
  let lastTime = performance.now();

  engine.runRenderLoop(() => {
    const currentTime = performance.now();
    const rawDelta = (currentTime - lastTime) / 1000;
    const deltaTime = clampDeltaTime(rawDelta);
    lastTime = currentTime;

    renderCallback(deltaTime);
  });
}
