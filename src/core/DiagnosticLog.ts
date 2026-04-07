/**
 * Diagnostic logging system for the Superman Flight Game.
 * Collects stats and logs summaries every few seconds to the browser console.
 * Designed for troubleshooting - logs are grouped and throttled to avoid spam.
 *
 * Usage: DiagnosticLog.log('Category', 'message') for one-off events
 *        DiagnosticLog.count('Category', 'metric') for counting events
 *        DiagnosticLog.track('Category', 'metric', value) for tracking values
 */

const LOG_INTERVAL = 3000; // Log summary every 3 seconds

interface CategoryStats {
  counts: Map<string, number>;
  values: Map<string, { sum: number; count: number; min: number; max: number }>;
  events: string[];
}

class DiagnosticLogImpl {
  private categories: Map<string, CategoryStats> = new Map();
  private lastLogTime = 0;
  private enabled = true;

  /**
   * Log a one-off event (throttled - only first per interval per category)
   */
  public log(category: string, message: string): void {
    if (!this.enabled) return;
    const stats = this.getCategory(category);
    if (stats.events.length < 10) { // Cap events per interval
      stats.events.push(message);
    }
    this.maybeFlush();
  }

  /**
   * Count an occurrence of something
   */
  public count(category: string, metric: string): void {
    if (!this.enabled) return;
    const stats = this.getCategory(category);
    stats.counts.set(metric, (stats.counts.get(metric) || 0) + 1);
  }

  /**
   * Track a numeric value (will report min/max/avg)
   */
  public track(category: string, metric: string, value: number): void {
    if (!this.enabled) return;
    const stats = this.getCategory(category);
    let v = stats.values.get(metric);
    if (!v) {
      v = { sum: 0, count: 0, min: Infinity, max: -Infinity };
      stats.values.set(metric, v);
    }
    v.sum += value;
    v.count++;
    v.min = Math.min(v.min, value);
    v.max = Math.max(v.max, value);
  }

  /**
   * Force an immediate log flush
   */
  public flush(): void {
    const now = performance.now();
    const elapsed = now - this.lastLogTime;
    this.lastLogTime = now;

    let hasData = false;
    for (const [, stats] of this.categories) {
      if (stats.events.length > 0 || stats.counts.size > 0 || stats.values.size > 0) {
        hasData = true;
        break;
      }
    }
    if (!hasData) return;

    console.group(`[Diagnostics] ${(elapsed / 1000).toFixed(1)}s interval`);

    for (const [name, stats] of this.categories) {
      const parts: string[] = [];

      // Events
      for (const event of stats.events) {
        parts.push(event);
      }

      // Counts
      for (const [metric, count] of stats.counts) {
        parts.push(`${metric}=${count}`);
      }

      // Values
      for (const [metric, v] of stats.values) {
        if (v.count === 1) {
          parts.push(`${metric}=${v.sum.toFixed(1)}`);
        } else {
          parts.push(`${metric}: avg=${(v.sum / v.count).toFixed(1)}, min=${v.min.toFixed(1)}, max=${v.max.toFixed(1)} (${v.count}x)`);
        }
      }

      if (parts.length > 0) {
        console.log(`[${name}]`, parts.join(' | '));
      }

      // Reset
      stats.events = [];
      stats.counts.clear();
      stats.values.clear();
    }

    console.groupEnd();
  }

  private getCategory(name: string): CategoryStats {
    let cat = this.categories.get(name);
    if (!cat) {
      cat = { counts: new Map(), values: new Map(), events: [] };
      this.categories.set(name, cat);
    }
    return cat;
  }

  private maybeFlush(): void {
    const now = performance.now();
    if (now - this.lastLogTime > LOG_INTERVAL) {
      this.flush();
    }
  }

  /**
   * Call each frame to enable time-based flushing
   */
  public update(): void {
    this.maybeFlush();
  }
}

export const Diag = new DiagnosticLogImpl();
