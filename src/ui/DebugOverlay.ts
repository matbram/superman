/**
 * Debug Overlay
 * Shows technical information for development and debugging
 * Toggle with backtick (`) key
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PlayerStateType } from '../player/PlayerState';

/**
 * Debug overlay manager
 */
export class DebugOverlay {
  private overlayElement: HTMLElement;
  private fpsElement: HTMLElement;
  private stateElement: HTMLElement;
  private speedElement: HTMLElement;
  private positionElement: HTMLElement;
  private velocityElement: HTMLElement;
  private inputElement: HTMLElement;

  private isVisible: boolean = false;
  private fpsBuffer: Float32Array;
  private fpsBufferIdx: number = 0;
  private fpsBufferFilled: boolean = false;
  private readonly FPS_BUFFER_SIZE = 30;
  private frameCounter: number = 0;

  constructor() {
    this.overlayElement = document.getElementById('debugOverlay')!;
    this.fpsElement = document.getElementById('debugFps')!;
    this.stateElement = document.getElementById('debugState')!;
    this.speedElement = document.getElementById('debugSpeed')!;
    this.positionElement = document.getElementById('debugPosition')!;
    this.velocityElement = document.getElementById('debugVelocity')!;
    this.inputElement = document.getElementById('debugInput')!;

    this.fpsBuffer = new Float32Array(this.FPS_BUFFER_SIZE);

    if (!this.overlayElement) {
      console.error('Debug overlay element not found');
    }
  }

  /**
   * Updates debug information
   */
  public update(
    engine: Engine,
    state: PlayerStateType,
    speed: number,
    position: Vector3,
    velocity: Vector3,
    inputInfo: string
  ): void {
    if (!this.isVisible) return;

    // Throttle debug overlay DOM updates to every 5th frame
    this.frameCounter++;
    if (this.frameCounter % 5 !== 0) return;

    // Ring buffer FPS - O(1) instead of O(n) shift()
    const currentFps = engine.getFps();
    this.fpsBuffer[this.fpsBufferIdx] = currentFps;
    this.fpsBufferIdx = (this.fpsBufferIdx + 1) % this.FPS_BUFFER_SIZE;
    if (!this.fpsBufferFilled && this.fpsBufferIdx === 0) this.fpsBufferFilled = true;

    const count = this.fpsBufferFilled ? this.FPS_BUFFER_SIZE : this.fpsBufferIdx;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.fpsBuffer[i];
    const avgFps = count > 0 ? sum / count : 0;

    this.fpsElement.textContent = avgFps.toFixed(1);
    this.stateElement.textContent = state;
    this.speedElement.textContent = speed.toFixed(1) + ' m/s';
    this.positionElement.textContent = this.formatVector(position);
    this.velocityElement.textContent = this.formatVector(velocity);
    this.inputElement.textContent = inputInfo;

    if (avgFps >= 55) {
      this.fpsElement.style.color = '#0f0';
    } else if (avgFps >= 30) {
      this.fpsElement.style.color = '#ff0';
    } else {
      this.fpsElement.style.color = '#f00';
    }
  }

  /**
   * Formats a vector for display
   */
  private formatVector(v: Vector3): string {
    return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
  }

  /**
   * Shows the debug overlay
   */
  public show(): void {
    this.isVisible = true;
    this.overlayElement.classList.add('visible');
  }

  /**
   * Hides the debug overlay
   */
  public hide(): void {
    this.isVisible = false;
    this.overlayElement.classList.remove('visible');
  }

  /**
   * Toggles debug overlay visibility
   */
  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Returns whether debug overlay is visible
   */
  public getIsVisible(): boolean {
    return this.isVisible;
  }
}
