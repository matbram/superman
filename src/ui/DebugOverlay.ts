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
  private fpsBuffer: number[] = [];
  private readonly FPS_BUFFER_SIZE = 30;

  constructor() {
    this.overlayElement = document.getElementById('debugOverlay')!;
    this.fpsElement = document.getElementById('debugFps')!;
    this.stateElement = document.getElementById('debugState')!;
    this.speedElement = document.getElementById('debugSpeed')!;
    this.positionElement = document.getElementById('debugPosition')!;
    this.velocityElement = document.getElementById('debugVelocity')!;
    this.inputElement = document.getElementById('debugInput')!;

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

    // Calculate smoothed FPS
    const currentFps = engine.getFps();
    this.fpsBuffer.push(currentFps);
    if (this.fpsBuffer.length > this.FPS_BUFFER_SIZE) {
      this.fpsBuffer.shift();
    }
    const avgFps = this.fpsBuffer.reduce((a, b) => a + b, 0) / this.fpsBuffer.length;

    // Update elements
    this.fpsElement.textContent = avgFps.toFixed(1);
    this.stateElement.textContent = state;
    this.speedElement.textContent = speed.toFixed(1) + ' m/s';
    this.positionElement.textContent = this.formatVector(position);
    this.velocityElement.textContent = this.formatVector(velocity);
    this.inputElement.textContent = inputInfo;

    // Color code FPS
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
