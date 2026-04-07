/**
 * HUD (Heads-Up Display)
 * Shows player status information during gameplay
 */

import { PlayerStateType } from '../player/PlayerState';

const MAX_DISPLAY_SPEED = 150; // m/s for full bar

/**
 * HUD manager class
 */
export class Hud {
  private hudElement: HTMLElement;
  private modeElement: HTMLElement;
  private speedElement: HTMLElement;
  private speedFillElement: HTMLElement;
  private boostIndicator: HTMLElement;

  private isVisible: boolean = true;
  private frameCounter: number = 0;
  private lastState: PlayerStateType = PlayerStateType.Grounded;

  constructor() {
    this.hudElement = document.getElementById('hud')!;
    this.modeElement = document.getElementById('hudMode')!;
    this.speedElement = document.getElementById('hudSpeed')!;
    this.speedFillElement = document.getElementById('speedFill')!;
    this.boostIndicator = document.getElementById('boostIndicator')!;

    if (!this.hudElement) {
      console.error('HUD element not found');
    }
  }

  /**
   * Updates the HUD with current player state
   */
  public update(
    stateType: PlayerStateType,
    speed: number,
    isBoostActive: boolean
  ): void {
    if (!this.isVisible) return;

    // Throttle DOM updates to every 3rd frame
    this.frameCounter++;
    const stateChanged = stateType !== this.lastState;

    if (this.frameCounter % 3 !== 0 && !stateChanged) return;

    if (stateChanged) {
      this.lastState = stateType;
      this.modeElement.textContent = this.getStateDisplayName(stateType);
      this.modeElement.style.color = this.getStateColor(stateType);
    }

    const displaySpeed = Math.round(speed);
    this.speedElement.textContent = displaySpeed.toString();

    const speedPercent = Math.min(100, (speed / MAX_DISPLAY_SPEED) * 100);
    this.speedFillElement.style.width = `${speedPercent}%`;

    if (isBoostActive) {
      this.boostIndicator.classList.add('active');
    } else {
      this.boostIndicator.classList.remove('active');
    }
  }

  /**
   * Gets display name for state
   */
  private getStateDisplayName(state: PlayerStateType): string {
    switch (state) {
      case PlayerStateType.Grounded:
        return 'GROUND';
      case PlayerStateType.Takeoff:
        return 'TAKEOFF';
      case PlayerStateType.Flight:
        return 'FLIGHT';
      case PlayerStateType.Hover:
        return 'HOVER';
      case PlayerStateType.Landing:
        return 'LANDING';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Gets color for state
   */
  private getStateColor(state: PlayerStateType): string {
    switch (state) {
      case PlayerStateType.Grounded:
        return '#88ff88';
      case PlayerStateType.Takeoff:
        return '#ffff44';
      case PlayerStateType.Flight:
        return '#44aaff';
      case PlayerStateType.Hover:
        return '#ff88ff';
      case PlayerStateType.Landing:
        return '#ffaa44';
      default:
        return '#ffffff';
    }
  }

  /**
   * Shows the HUD
   */
  public show(): void {
    this.isVisible = true;
    this.hudElement.style.display = 'block';
  }

  /**
   * Hides the HUD
   */
  public hide(): void {
    this.isVisible = false;
    this.hudElement.style.display = 'none';
  }

  /**
   * Toggles HUD visibility
   */
  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}
