// One audible output for every Binnacle-owned alarm tone. Each consumer keeps its own policy (what
// counts as "should sound") and its own GatedAlarm edge detection; this owns which single tone
// reaches the speaker, so independent alarms can never sum at the destination or mask each other.
//
// The priority model: a channel registers with a live rank getter (lower is more urgent), because
// a channel's grade can change while it sounds (the collision escalation is co-equal with MOB
// exactly while it is escalating). The most urgent active channels play; several sharing the top
// rank interleave burst by burst, so MOB and an escalating close-quarters contact both stay
// audible. Lower-priority active channels stay visually present elsewhere and get a single-burst
// audible reminder on a bounded interval. A courtesy channel (arrival) never sounds while any
// safety channel is active. Silencing decisions (mute, acknowledge, boat-wide silence) stay at
// the call sites; this never issues one.
import { Alarm, type AlarmControl, type AlarmTone } from './alarm';

export interface AlarmChannelOptions {
  id: string;
  // Live priority, lower is more urgent. A getter, never a captured value.
  rank: () => number;
  // A courtesy tone plays only while it is the sole active channel.
  courtesy?: boolean;
}

// How often a lower-priority active channel is reminded audibly beneath the urgent pattern.
const REMINDER_INTERVAL_MS = 10_000;

interface ChannelState {
  options: AlarmChannelOptions;
  active: boolean;
  tone: AlarmTone | undefined;
  lastReminderAt: number;
  // A rising edge re-articulates the pattern even when the playing tone stays the same.
  needsArticulation: boolean;
}

export class AlarmCoordinator {
  #output: AlarmControl;
  #channels: ChannelState[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #playingId: string | undefined;
  #rotation = 0;
  #now: () => number;

  constructor(output: AlarmControl = new Alarm(), now: () => number = () => Date.now()) {
    this.#output = output;
    this.#now = now;
  }

  channel(options: AlarmChannelOptions): AlarmControl {
    const state: ChannelState = {
      options,
      active: false,
      tone: undefined,
      lastReminderAt: 0,
      needsArticulation: false,
    };
    this.#channels.push(state);
    return {
      start: (tone: AlarmTone) => {
        const rising = !state.active;
        state.active = true;
        state.tone = tone;
        if (rising) {
          state.needsArticulation = true;
          // A newly raised channel starts its reminder clock now: it either plays immediately or
          // is already being heard about through the announcement that raised it.
          state.lastReminderAt = this.#now();
        }
        this.#decide();
      },
      stop: () => {
        if (!state.active) return;
        state.active = false;
        this.#decide();
      },
    };
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#output.stop();
    this.#playingId = undefined;
  }

  // Recompute what should be sounding right now and schedule the next decision one burst period
  // out, which is what advances the interleave rotation and delivers due reminders.
  #decide(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;

    const actives = this.#channels.filter((state) => state.active && state.tone !== undefined);
    if (actives.length === 0) {
      this.#output.stop();
      this.#playingId = undefined;
      return;
    }
    const safeties = actives.filter((state) => state.options.courtesy !== true);
    // Arrival never preempts a safety condition: with any safety active, courtesy channels wait
    // entirely rather than joining the rotation or the reminders.
    const pool = safeties.length > 0 ? safeties : actives;

    const top = Math.min(...pool.map((state) => state.options.rank()));
    const tops = pool.filter((state) => state.options.rank() === top);

    const now = this.#now();
    const reminder = pool
      .filter((state) => !tops.includes(state))
      .filter((state) => now - state.lastReminderAt >= REMINDER_INTERVAL_MS)
      .sort((a, b) => a.options.rank() - b.options.rank())[0];

    let chosen: ChannelState;
    if (reminder) {
      chosen = reminder;
    } else {
      chosen = tops[this.#rotation % tops.length];
      this.#rotation += 1;
    }
    // Any play resets the channel's reminder clock: "due for a reminder" means it has not been
    // heard for the whole interval, whether its last hearing was a rotation slot or a reminder.
    chosen.lastReminderAt = now;

    const tone = chosen.tone;
    if (!tone) return;
    if (chosen.options.id !== this.#playingId || chosen.needsArticulation) {
      // A restart re-articulates the pattern, so a newly raised equal-priority event is heard
      // within one burst period instead of being absorbed by the running loop.
      this.#output.stop();
      chosen.needsArticulation = false;
    }
    this.#output.start(tone);
    this.#playingId = chosen.options.id;
    this.#timer = setTimeout(() => this.#decide(), tone.periodMs);
  }
}
