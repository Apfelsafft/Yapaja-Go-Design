/**
 * Den Bildschirm anlassen, solange Yapaia zu sehen ist.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Nach gewisser Zeit geht das iPad in den Sperrbildschirm. Bitte
 * verhindere dies bei der Nutzung von Yapaia. Quasi analog zu Maps, das kann
 * auch immer offen bleiben."
 *
 * ─── WARUM ZWEI WEGE, UND WARUM DER ZWEITE DER WICHTIGE IST ─────────────────
 * Der gerade Weg ist `navigator.wakeLock`. Der steht aber ausschliesslich in
 * einem SICHEREN KONTEXT zur Verfuegung (HTTPS oder localhost) -- die
 * Schnittstelle ist sonst gar nicht erst vorhanden, `navigator.wakeLock` ist
 * schlicht `undefined`.
 *
 * Genau das ist hier der Normalfall und nicht die Ausnahme: Home Assistant
 * laeuft in dieser Installation ueber einfaches HTTP im LAN
 * (`http://192.168.178.111:8123/...`), und Yapaia steckt als Ingress-Rahmen
 * darin. Auf dem iPad gibt es diese Schnittstelle also NICHT, egal wie neu
 * das iOS ist. Wer hier nur `wakeLock` einbaut, hat eine Funktion gebaut, die
 * bei genau der Person nicht laeuft, die sie bestellt hat.
 *
 * Der zweite Weg ist deshalb kein Beiwerk, sondern der, der hier greift: ein
 * winziges, stummes, endlos laufendes Video. Solange ein Video laeuft, haelt
 * iOS den Bildschirm wach. Das Video ist 2x2 Bildpunkte gross, schwarz,
 * zwei Sekunden lang und liegt in zwei Formaten neben der Anwendung
 * (`media/awake.mp4` fuer Safari, `media/awake.webm` fuer Chromium ohne
 * H.264). Es hat KEINE Tonspur -- eine stumme Tonspur wuerde auf iOS die
 * Audiositzung an sich reissen und im Wohnmobil die Musik unterbrechen.
 *
 * ─── WARUM EIN EIGENES MODUL OHNE REACT UND OHNE DOM ────────────────────────
 * Damit die Zustandsmaschine PRUEFBAR ist. Alles, was hier entscheidet --
 * anfordern, freigeben, nach dem Wiedersichtbarwerden erneut anfordern, auf
 * eine Geste warten -- laeuft ueber die eingereichte {@link Umgebung}. Der
 * echte Browser wird erst in `ScreenAwakeController.tsx` eingesetzt.
 */

/** Was `navigator.wakeLock.request()` zurueckgibt -- nur das, was wir nutzen. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** `navigator.wakeLock`. */
export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** Das Rueckfall-Video. */
export interface VideoLike {
  play(): Promise<void>;
  pause(): void;
}

export interface Umgebung {
  /** `null`, wenn es die Schnittstelle nicht gibt -- der Normalfall ueber HTTP. */
  wakeLock: WakeLockLike | null;
  /** `null` nur, wenn kein Video angelegt werden konnte. */
  video: VideoLike | null;
  /** Ob die Seite gerade sichtbar ist. Unsichtbar wird nichts angefordert. */
  sichtbar(): boolean;
}

/** Womit der Bildschirm gerade wachgehalten wird. */
export type Methode = 'wakelock' | 'video' | 'keine';

export interface Zustand {
  /** Ob wachgehalten werden SOLL (unabhaengig davon, ob es gerade gelingt). */
  gewuenscht: boolean;
  methode: Methode;
  /**
   * Ob das Video abgelehnt wurde und auf die erste Bedienung gewartet wird.
   * Stummes Abspielen ist auf iOS eigentlich ohne Geste erlaubt; im
   * Stromsparmodus ist es das nicht.
   */
  wartetAufGeste: boolean;
}

export class ScreenAwake {
  private readonly umgebung: Umgebung;
  private gewuenscht = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private videoLaeuft = false;
  private wartetAufGeste = false;

  constructor(umgebung: Umgebung) {
    this.umgebung = umgebung;
  }

  zustand(): Zustand {
    return {
      gewuenscht: this.gewuenscht,
      methode: this.sentinel ? 'wakelock' : this.videoLaeuft ? 'video' : 'keine',
      wartetAufGeste: this.wartetAufGeste,
    };
  }

  /** Ab jetzt wachhalten. Mehrfaches Aufrufen ist harmlos. */
  async an(): Promise<void> {
    this.gewuenscht = true;
    await this.anfordern();
  }

  /** Wieder loslassen -- der Bildschirm darf sich normal abschalten. */
  async aus(): Promise<void> {
    this.gewuenscht = false;
    this.wartetAufGeste = false;
    await this.freigeben();
  }

  /**
   * Die Seite wurde ein- oder ausgeblendet.
   *
   * Der Browser gibt eine Wake-Lock beim Ausblenden VON SELBST frei; ohne
   * dieses erneute Anfordern waere sie nach dem ersten Wechsel in eine andere
   * App fuer immer weg -- und zwar lautlos.
   */
  async sichtbarkeitGeaendert(): Promise<void> {
    if (!this.gewuenscht) return;
    if (this.umgebung.sichtbar()) {
      await this.anfordern();
    } else {
      // Nur den eigenen Merker aufraeumen: das Video pausiert der Browser
      // selbst, und die Wake-Lock ist bereits freigegeben.
      this.sentinel = null;
      this.videoLaeuft = false;
    }
  }

  /**
   * Es wurde etwas bedient. Nur dann interessant, wenn das Video vorher
   * abgelehnt wurde -- jetzt darf es.
   */
  async geste(): Promise<void> {
    if (!this.gewuenscht || !this.wartetAufGeste) return;
    this.wartetAufGeste = false;
    await this.anfordern();
  }

  private async anfordern(): Promise<void> {
    if (!this.gewuenscht || !this.umgebung.sichtbar()) return;
    if (this.sentinel || this.videoLaeuft) return;

    if (this.umgebung.wakeLock) {
      try {
        const sentinel = await this.umgebung.wakeLock.request('screen');
        // Erst nach dem Warten pruefen: in der Zwischenzeit kann `aus()`
        // gelaufen sein. Ohne diese Abfrage bliebe eine Sperre haengen, die
        // niemand mehr freigibt.
        if (!this.gewuenscht) {
          await sentinel.release().catch(() => undefined);
          return;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener('release', () => {
          this.sentinel = null;
        });
        return;
      } catch {
        // Weiter zum Video. Eine abgelehnte Wake-Lock (etwa im
        // Stromsparmodus) ist kein Grund, gar nichts zu tun.
      }
    }

    const video = this.umgebung.video;
    if (!video) return;
    try {
      await video.play();
      if (!this.gewuenscht) {
        video.pause();
        return;
      }
      this.videoLaeuft = true;
    } catch {
      this.wartetAufGeste = true;
    }
  }

  private async freigeben(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) await sentinel.release().catch(() => undefined);
    if (this.videoLaeuft) {
      this.videoLaeuft = false;
      this.umgebung.video?.pause();
    }
  }
}
