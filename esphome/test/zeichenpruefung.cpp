// Prueft die Zeichenroutine aus yapaja-nav-display.yaml, indem sie
// UEBERSETZT UND AUSGEFUEHRT wird -- gegen einen Nachbau der ESPHome-API mit
// denselben Signaturen. Faengt genau das, was eine Sichtpruefung nicht faengt:
// Tippfehler, falsche Argumentzahlen, Referenz-statt-Zeiger, und Zeichnungen,
// die aus dem Bild laufen.
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstdarg>
#include <ctime>
#include <string>
#include <vector>
#include <algorithm>

namespace esphome {

struct Color { uint8_t r,g,b; };
static Color COLOR_ON{255,255,255}, COLOR_OFF{0,0,0};
struct BaseFont { int size; };
enum class TextAlign { TOP_LEFT, TOP_CENTER, TOP_RIGHT, CENTER_LEFT, CENTER,
                       CENTER_RIGHT, BASELINE_LEFT, BOTTOM_LEFT };

namespace sensor { struct Sensor {
  bool has = true; float state = 0;
  bool has_state() const { return has; }
}; }
namespace text_sensor { struct TextSensor { std::string state; }; }
namespace binary_sensor { struct BinarySensor { bool state = false; }; }
// `switch` ist in C++ ein Schluesselwort; ESPHome nennt den Namensraum
// deshalb `switch_`. Fuer diese Pruefung zaehlt nur `.state`.
namespace switch_ { struct Switch { bool state = false; }; }

struct ESPTime {
  uint8_t second=0, minute=0, hour=0, day_of_week=0, day_of_month=0;
  uint16_t day_of_year=0; uint8_t month=0; uint16_t year=0;
  bool is_dst=false; time_t timestamp=0;
  void recalc_timestamp_utc(bool use_day_of_year = true) {
    struct tm t{}; t.tm_year=year-1900; t.tm_mon=month-1; t.tm_mday=day_of_month;
    t.tm_hour=hour; t.tm_min=minute; t.tm_sec=second;
    timestamp = timegm(&t);
  }
  static ESPTime from_epoch_local(time_t epoch) {
    struct tm l{}; localtime_r(&epoch, &l);
    ESPTime e; e.year=l.tm_year+1900; e.month=l.tm_mon+1; e.day_of_month=l.tm_mday;
    e.hour=l.tm_hour; e.minute=l.tm_min; e.second=l.tm_sec; e.timestamp=epoch;
    return e;
  }
};

// Nimmt jede Zeichnung entgegen und merkt sich die aeussersten Punkte.
struct Display {
  int w, h;
  int minx=1<<30, miny=1<<30, maxx=-(1<<30), maxy=-(1<<30);
  int aufrufe = 0;
  std::vector<std::string> texte;
  std::vector<std::pair<int,int>> punkte;
  int pminx=1<<30, pmaxx=-(1<<30);  // nur die Pfeilformen
  std::string formen;  // R=Rechteck T=Dreieck O=Ring C=Kreis L=Linie
  bool zeichne_protokoll = false;

  Display(int w_, int h_) : w(w_), h(h_) {}
  int get_width() { return w; }
  int get_height() { return h; }

  void punkt(int x, int y) {
    minx=std::min(minx,x); maxx=std::max(maxx,x);
    miny=std::min(miny,y); maxy=std::max(maxy,y);
    punkte.emplace_back(x, y);
    aufrufe++;
  }
  // Wie `punkt`, aber zaehlt zusaetzlich in die Pfeil-Box -- solange die
  // Trennlinie noch nicht gezeichnet ist. Nur Formen rufen das auf: der
  // Hintergrund faerbt das ganze Bild, und der Anweisungstext steht rechts
  // vom Pfeil. Beides in die Box zu nehmen machte jede Richtung zu "rechts".
  void spunkt(int x, int y) {
    if (!pfeil_fertig) { pminx=std::min(pminx,x); pmaxx=std::max(pmaxx,x); }
    punkt(x, y);
  }
  // Der Pfeil ist die erste Formgruppe. Er endet, sobald nach mindestens
  // einer Form ein Text kommt (die Entfernung darunter). Der Anweisungstext
  // DARUEBER kommt vor jeder Form und beendet ihn deshalb nicht.
  bool pfeil_fertig = false;
  std::string pfeil_formen;
  void text_gezeichnet() {
    if (!formen.empty() && !pfeil_fertig) { pfeil_fertig = true; pfeil_formen = formen; }
  }
  // Faerbt bewusst das GANZE Rechteck -- auch die Ecken, die auf einem
  // runden Panel niemand sieht. Zaehlt deshalb nicht als Zeichnung.
  void fill(Color) { }
  void line(int x1,int y1,int x2,int y2,Color c=COLOR_ON){spunkt(x1,y1);spunkt(x2,y2);}
  void horizontal_line(int x,int y,int width,Color c=COLOR_ON){formen+='L';punkt(x,y);punkt(x+width-1,y);}
  void vertical_line(int x,int y,int height,Color c=COLOR_ON){punkt(x,y);punkt(x,y+height-1);}
  void rectangle(int x,int y,int width,int height,Color c=COLOR_ON){spunkt(x,y);spunkt(x+width,y+height);}
  void filled_rectangle(int x,int y,int width,int height,Color c=COLOR_ON){
    formen+='R';
    // Negative Breite/Hoehe sind erlaubt (ESPHome zeichnet dann nach links/oben),
    // fuer die Randpruefung zaehlen beide Ecken.
    spunkt(x,y); spunkt(x+width,y+height);
  }
  void circle(int cx,int cy,int r,Color c=COLOR_ON){spunkt(cx-r,cy-r);spunkt(cx+r,cy+r);}
  void filled_circle(int cx,int cy,int r,Color c=COLOR_ON){formen+='C';spunkt(cx-r,cy-r);spunkt(cx+r,cy+r);}
  void filled_ring(int cx,int cy,int r1,int r2,Color c=COLOR_ON){
    formen+='O';
    int r=std::max(r1,r2); spunkt(cx-r,cy-r); spunkt(cx+r,cy+r);
  }
  void triangle(int x1,int y1,int x2,int y2,int x3,int y3,Color c=COLOR_ON){
    spunkt(x1,y1);spunkt(x2,y2);spunkt(x3,y3);
  }
  void filled_triangle(int x1,int y1,int x2,int y2,int x3,int y3,Color c=COLOR_ON){
    formen+='T';
    spunkt(x1,y1);spunkt(x2,y2);spunkt(x3,y3);
  }
  void print(int x,int y,BaseFont*f,Color c,TextAlign a,const char*t){
    text_gezeichnet(); punkt(x,y); texte.push_back(t);
  }
  void printf(int x,int y,BaseFont*f,Color c,TextAlign a,const char*fmt,...){
    char buf[256]; va_list ap; va_start(ap,fmt);
    vsnprintf(buf,sizeof buf,fmt,ap); va_end(ap);
    text_gezeichnet(); punkt(x,y); texte.push_back(buf);
  }
};

} // namespace esphome
using namespace esphome;

// ─── Die Objekte, die `id(...)` im echten Lambda liefert ────────────────────
static BaseFont f_xl{46}, f_l{34}, f_m{19}, f_s{14};
static Color k_hintergrund{0x10,0x14,0x18}, k_text{0xF2,0xF5,0xF7},
             k_gedaempft{0x8A,0x94,0x9E}, k_pfeil{0x4E,0xA1,0xFF},
             k_warnung{0xFF,0x4D,0x4D}, k_gut{0x3D,0xDC,0x84}, k_schild{255,255,255};
static sensor::Sensor s_tempo, s_limit, s_limit_fz, s_mdist, s_rest;
// Die digitale Wasserwaage: Neigung links/rechts und vorne/hinten.
static sensor::Sensor s_lr, s_vh;
static binary_sensor::BinarySensor s_schnell;
static text_sensor::TextSensor s_anweisung, s_art, s_zustand, s_ankunft;
// Die beiden Schalter: Waage erzwingen, und Fahrzeug statt Libelle.
static switch_::Switch s_erzwingen, s_fahrzeug;

// ─── Die Variablen, die ESPHome erzeugt ────────────────────────────────────
// KEIN `#define id(...)` mehr. ESPHome setzt `id(name)` in die C++-Variable
// selbst um — bei Komponenten ein ZEIGER — und nur `id(name).` wird zu
// `name->`. `run.mjs` bildet genau diese Umschreibung nach; hier stehen
// deshalb schlicht die Variablen, die danach im Text stehen.
//
// Bis 0.11.1 stand hier ein `#define id(x) _id_##x`, das jede Kennung auf ein
// OBJEKT abbildete — damit `id(x).state` übersetzt. Genau dadurch übersetzte
// auch `hilfsfunktion(id(x))`, was auf dem Gerät scheitert. Eine Prüfung, die
// eine Annahme nachbaut statt der Wirklichkeit, prüft die Annahme.
static BaseFont *font_xl = &f_xl, *font_l = &f_l, *font_m = &f_m, *font_s = &f_s;

// Farben kommen aus `color:` und sind WERTE (`cg.variable`), keine Zeiger.
static Color &c_hintergrund = k_hintergrund, &c_text = k_text,
             &c_gedaempft = k_gedaempft, &c_pfeil = k_pfeil,
             &c_warnung = k_warnung, &c_gut = k_gut, &c_schild = k_schild;

static sensor::Sensor *yapaja_tempo = &s_tempo, *yapaja_tempolimit = &s_limit,
                      *yapaja_tempolimit_fahrzeug = &s_limit_fz,
                      *yapaja_manoever_entfernung = &s_mdist,
                      *yapaja_reststrecke = &s_rest;
static sensor::Sensor *neigung_lr = &s_lr, *neigung_vh = &s_vh;
static switch_::Switch *waage_erzwingen = &s_erzwingen, *waage_fahrzeug = &s_fahrzeug;
static binary_sensor::BinarySensor *yapaja_zu_schnell = &s_schnell;
static text_sensor::TextSensor *yapaja_anweisung = &s_anweisung,
                               *yapaja_manoever_art = &s_art,
                               *yapaja_fahrzustand = &s_zustand,
                               *yapaja_ankunft = &s_ankunft;

static void zeichne(Display &it) {
#include "lambda_body.inc"  // wird von run.mjs erzeugt
}

// ─── Die Faelle ────────────────────────────────────────────────────────────
struct Fall {
  const char *name;
  const char *zustand, *art, *anweisung, *ankunft;
  float tempo, limit, mdist, rest; bool tempo_da, limit_da, mdist_da, rest_da;
  // Was DIESES Fahrzeug darf -- getrennt vom Schild.
  float limit_fz; bool limit_fz_da;
  // Neigung in Grad, fuer die Wasserwaage.
  float lr, vh; bool neigung_da;
  bool schnell;
  // ─── DIE BEIDEN SCHALTER ─────────────────────────────────────────────────
  // Sie gehoeren in den `Fall` und nicht in eine globale Variable daneben:
  // `Fall` ist die vollstaendige Beschreibung dessen, was das Geraet sieht.
  // Ein Zustand, der ausserhalb steht, wird beim naechsten Fall vergessen
  // zurueckzusetzen -- und dann traegt ein Test den Schalter des vorigen mit
  // sich, ohne dass es jemandem auffaellt.
  bool erzwingen;
  bool fahrzeug;
};

static int fehler = 0;

/**
 * Setzt ALLE Bauteile aus einem `Fall`.
 *
 * ─── WARUM DAS EINE FUNKTION IST UND VIER WAREN ──────────────────────────
 * Diese Datei hatte den Aufbau VIER MAL: in `lauf`, in `erwarte`, in `genau`
 * und noch einmal im erzwungenen Diagnosemodus. Jede Erweiterung musste an
 * allen vier nachgezogen werden.
 *
 * Beim Zufuegen der Fahrzeuggrenze wurde eine vergessen -- und die Folge war
 * kein Fehler, sondern Stille: der Sensor blieb leer, die Zahl wurde nie
 * gezeichnet, und der Test bestand trotzdem, weil auch er nichts erwartete.
 * Das steht seither als Warnung in dieser Datei.
 *
 * Beim Zufuegen der beiden Schalter ist es GENAU WIEDER PASSIERT: drei
 * Stellen nachgezogen, die vierte uebersehen. Diesmal fiel es auf, weil die
 * neuen Faelle etwas erwarteten -- aber eine Warnung, die man liest und dann
 * doch in dieselbe Falle laeuft, ist keine Loesung. Also gibt es den Aufbau
 * ab jetzt nur noch hier.
 *
 * Was Home Assistant fuer „weiss ich nicht" schickt, ist NaN -- nicht 0. Mit
 * 0 waere jede Pruefung auf die NaN-Absicherung wirkungslos.
 */
static void aufbauen(const Fall &f) {
  s_zustand.state = f.zustand; s_art.state = f.art;
  s_anweisung.state = f.anweisung; s_ankunft.state = f.ankunft;
  auto setze = [](sensor::Sensor &s, float wert, bool da) {
    s.has = da; s.state = da ? wert : NAN;
  };
  setze(s_tempo,    f.tempo,    f.tempo_da);
  setze(s_limit,    f.limit,    f.limit_da);
  setze(s_limit_fz, f.limit_fz, f.limit_fz_da);
  setze(s_lr,       f.lr,       f.neigung_da);
  setze(s_vh,       f.vh,       f.neigung_da);
  setze(s_mdist,    f.mdist,    f.mdist_da);
  setze(s_rest,     f.rest,     f.rest_da);
  s_schnell.state   = f.schnell;
  s_erzwingen.state = f.erzwingen;
  s_fahrzeug.state  = f.fahrzeug;
}

static bool rund_pruefen = true;

static void lauf(const Fall &f, int w, int h, bool zeige) {
  aufbauen(f);

  Display it(w, h);
  zeichne(it);

  // Rand mit etwas Toleranz: Text wird an einem Ankerpunkt ausgerichtet, die
  // Glyphen reichen darueber hinaus. Grob daneben faellt trotzdem auf.
  const int tol = 8;
  bool raus = it.minx < -tol || it.miny < -tol ||
              it.maxx > w + tol || it.maxy > h + tol;

  // ─── DAS RUNDE GLAS ─────────────────────────────────────────────────────
  // Auf einem runden Panel ist die Ecke nicht "abgeschnitten" -- sie ist gar
  // nicht da, und am Geraet deutet nichts darauf hin. Die Rechteckpruefung
  // allein liesse genau das durchgehen. Geprueft wird deshalb JEDER Eckpunkt
  // gegen den Kreis.
  if (rund_pruefen && !raus) {
    const double cx = w / 2.0, cy = h / 2.0;
    const double rmax = std::min(w, h) / 2.0 - 8 + tol;
    for (auto &pkt : it.punkte) {
      const double dx = pkt.first - cx, dy = pkt.second - cy;
      if (std::sqrt(dx * dx + dy * dy) > rmax) {
        printf("  FEHL %-22s %dx%d  Punkt (%d,%d) liegt %.0f vom Mittelpunkt,"
               " der Kreis endet bei %.0f\n",
               f.name, w, h, pkt.first, pkt.second,
               std::sqrt(dx * dx + dy * dy), rmax);
        fehler++;
        raus = true;
        break;
      }
    }
  }

  if (raus && !rund_pruefen) {
    printf("  FEHL %-22s %dx%d  Bereich x[%d..%d] y[%d..%d]\n",
           f.name, w, h, it.minx, it.maxx, it.miny, it.maxy);
    fehler++;
  } else if (!raus && zeige) {
    printf("  OK   %-22s %dx%d  x[%d..%d] y[%d..%d], %d Zeichnungen | ",
           f.name, w, h, it.minx, it.maxx, it.miny, it.maxy, it.aufrufe);
    for (auto &t : it.texte) printf("\"%s\" ", t.c_str());
    printf("\n");
  }
}

int main() {
  setenv("TZ", "Europe/Berlin", 1); tzset();

#ifdef NUR_SCHALTER
  // ══ Der dritte Lauf: `wasserwaage_bei_stillstand: "false"` ════════════════
  // Ohne die Tempo-Automatik oeffnet allein der Schalter die Waage. Gedacht
  // fuer den Fall, den der Betreiber genannt hat: „damit die Anzeige an einer
  // Ampel nicht umschaltet."
  {
    auto genau = [&](const char *name, const Fall &f, int w, int h,
                     std::vector<std::string> soll) {
      aufbauen(f);
      Display it(w,h); zeichne(it);
      if (it.texte != soll) {
        printf("  FEHL %-34s\n       soll:", name);
        for (auto &t : soll) printf(" \"%s\"", t.c_str());
        printf("\n       ist :");
        for (auto &t : it.texte) printf(" \"%s\"", t.c_str());
        printf("\n");
        fehler++;
      } else {
        printf("  OK   %s\n", name);
      }
    };

    printf("── Nur der Schalter oeffnet die Waage ──\n");

    Fall ampel{};
    ampel.name = "x";
    ampel.zustand = "navigating"; ampel.art = "turn_left";
    ampel.anweisung = "Links abbiegen"; ampel.ankunft = "2026-09-15T14:32:00.000Z";
    ampel.tempo = 0; ampel.tempo_da = true;
    ampel.mdist = 300; ampel.mdist_da = true;
    ampel.lr = 1.0f; ampel.vh = -1.5f; ampel.neigung_da = true;

    // ─── DER GEMELDETE FALL ─────────────────────────────────────────────
    // Stillstand mitten in der Navigation. Mit der Automatik waere hier die
    // Waage erschienen; ohne sie laeuft die Navigation weiter.
    genau("Stillstand an der Ampel: die Navigation bleibt", ampel, 240,240,
          {"Links abbiegen", "300 m", "0", "16:32"});

    // Und die Gegenprobe: der Schalter oeffnet sie sehr wohl. Ohne diesen
    // Fall waere die Abschaltung auch dann gruen, wenn die Waage GAR NICHT
    // mehr erreichbar waere.
    Fall rangiert = ampel; rangiert.erzwingen = true;
    genau("derselbe Stillstand MIT Schalter: die Waage", rangiert, 240,240,
          {"L/R +1.0\u00b0", "V/H -1.5\u00b0"});

    // Auch der Weg ueber ein unbekanntes Tempo ist zu -- er gehoert zur
    // selben Automatik. Uebrig bleibt die gewohnte Zustandsmeldung.
    Fall ohne_tempo{};
    ohne_tempo.name = "x";
    ohne_tempo.zustand = "idle"; ohne_tempo.art = "turn_left";
    ohne_tempo.anweisung = "unknown"; ohne_tempo.ankunft = "unknown";
    ohne_tempo.lr = 1.0f; ohne_tempo.vh = -1.5f; ohne_tempo.neigung_da = true;
    genau("kein Tempo, kein Schalter: keine Waage", ohne_tempo, 240,240,
          {"Keine Route"});
  }

  printf("\n%d Fehler\n", fehler);
  return fehler ? 1 : 0;
#endif

#ifdef DIAGNOSE_ERZWUNGEN
  // ══ Der zweite Lauf: `diagnose: "true"` ═══════════════════════════════════
  // `${diagnose}` wird VOR dem Uebersetzen ersetzt. Im ersten Lauf steht dort
  // `false`, und der Zweig dahinter ist im erzeugten C++ gar nicht enthalten
  // -- ungeprueft waere also ausgerechnet der Modus, den jemand einschaltet,
  // wenn ohnehin schon etwas nicht stimmt.
  //
  // `run.mjs` uebersetzt die Routine deshalb ein zweites Mal mit `true` und
  // setzt dabei diesen Schalter. Hier laufen dann NUR die Faelle, die es nur
  // in diesem Modus gibt.
  {
    auto genau = [&](const char *name, const Fall &f, int w, int h,
                     std::vector<std::string> soll) {
      aufbauen(f);
      Display it(w,h); zeichne(it);
      if (it.texte != soll) {
        printf("  FEHL %-26s\n       soll:", name);
        for (auto &t : soll) printf(" \"%s\"", t.c_str());
        printf("\n       ist :");
        for (auto &t : it.texte) printf(" \"%s\"", t.c_str());
        printf("\n");
        fehler++;
      } else {
        printf("  OK   %s\n", name);
      }
    };

    printf("── Erzwungene Diagnose ──\n");

    // ─── DER EIGENTLICHE ZWECK DIESES MODUS ───────────────────────────────
    // Volle Fahrt: es kommt alles an, was zaehlt. Trotzdem steht die Liste
    // da -- sonst liesse sich nicht nachsehen, WELCHE Werte ankommen, solange
    // wenigstens einer davon da ist.
    // ─── BENANNT UND NICHT NACH POSITION ──────────────────────────────────
    // `Fall` hat neunzehn Felder, von denen viele `bool` und `float`
    // nebeneinander sind. Eine Initialisierung nach Position ist dort nicht
    // zu lesen und beim ersten Versuch prompt verrutscht -- `70` landete auf
    // einem `bool`. Der Uebersetzer hat es gefangen; bei zwei `bool`
    // nebeneinander haette er geschwiegen.
    Fall voll{};
    voll.name = "x";
    voll.zustand = "navigating"; voll.art = "turn_left";
    voll.anweisung = "Links abbiegen auf B27";
    voll.ankunft = "2026-09-15T14:32:00.000Z";
    voll.tempo = 87;    voll.tempo_da = true;
    voll.limit = 80;    voll.limit_da = true;
    voll.mdist = 1240;  voll.mdist_da = true;
    voll.rest = 42.5f;  voll.rest_da = true;
    voll.limit_fz = 70; voll.limit_fz_da = true;
    voll.lr = 1.5f; voll.vh = -0.5f; voll.neigung_da = true;
    voll.schnell = false;
    genau("alles da: die Liste trotzdem, mit den Werten", voll, 240,240,
          {"Diagnose",
           "Tempo","87.0", "Limit","80.0", "Limit Fzg","70.0",
           "Entfernung","1240.0",
           "Zustand","navigating", "Anweisung","Links abbi",
           "Neig L/R","1.5", "Neig V/H","-0.5",
           "8 von 8 kommen an", "Fehlende: Namen pruefen"});

    // ─── DIE LAGE, DIE DIESEN MODUS NOETIG MACHT ──────────────────────────
    // Einzelne fehlen. Genau dann sagt die Zahl, wie viele -- und die
    // Beschriftungen daneben, WELCHE. Das ist die Auskunft, die die alte
    // Meldung „Kein Wert aus Home Assistant" nie gegeben hat.
    Fall halb = voll;
    halb.limit_da = false; halb.limit_fz_da = false; halb.neigung_da = false;
    genau("einzelne fehlen: die Zahl sagt wie viele", halb, 240,240,
          {"Diagnose",
           "Tempo","87.0", "Limit","--", "Limit Fzg","--",
           "Entfernung","1240.0",
           "Zustand","navigating", "Anweisung","Links abbi",
           "Neig L/R","--", "Neig V/H","--",
           "4 von 8 kommen an", "Fehlende: Namen pruefen"});

    // Die Gegenprobe zur Zahl: sie darf nicht fest sein. Ein Wert weniger,
    // eine Zahl weniger -- sonst waere sie Zierde.
    Fall halb_ohne_tempo = halb; halb_ohne_tempo.tempo_da = false;
    genau("ein Wert weniger, eine Zahl weniger", halb_ohne_tempo, 240,240,
          {"Diagnose",
           "Tempo","--", "Limit","--", "Limit Fzg","--",
           "Entfernung","1240.0",
           "Zustand","navigating", "Anweisung","Links abbi",
           "Neig L/R","--", "Neig V/H","--",
           "3 von 8 kommen an", "Fehlende: Namen pruefen"});

    // Und auch im erzwungenen Modus gilt: kommt NICHTS an, ist das der
    // Befund und nicht „0 von 8". Die Zahl allein saehe aus wie ein Zaehler,
    // der noch laeuft.
    Fall gar_nichts{};
    gar_nichts.name = "x";
    gar_nichts.zustand = ""; gar_nichts.art = "turn_left";
    gar_nichts.anweisung = "unknown"; gar_nichts.ankunft = "unknown";
    genau("nichts kommt an: derselbe Befund wie von allein", gar_nichts, 240,240,
          {"Diagnose",
           "Tempo","--", "Limit","--", "Limit Fzg","--", "Entfernung","--",
           "Zustand","--", "Anweisung","--", "Neig L/R","--", "Neig V/H","--",
           "Nichts kommt an", "ESPHome in HA einbinden"});
  }

  printf("\n%d Fehler\n", fehler);
  return fehler ? 1 : 0;
#else

  // Alle ManeuverType-Werte aus mapping.ts PLUS die Valhalla-Werte, die der
  // Typ als `| string` ausdruecklich zulaesst.
  const char *arten[] = {
    "turn_left","turn_right","uturn_left","uturn_right","roundabout_enter",
    "roundabout_exit","straight","continue","slight_left","sharp_right",
    "ramp_left","ramp_right","merge","destination","start","",
    "unknown","exit_roundabout_left"
  };

  printf("── Fahrt, alle Manoeverarten, 320x240 ──\n");
  for (auto *a : arten) {
    Fall f{a, "navigating", a, "Links abbiegen auf die B27 Richtung Tübingen",
           "2026-09-15T14:32:00.000Z", 87, 80, 1240, 42.5,
           true, true, true, true, false};
    lauf(f, 320, 240, false);
  }
  printf("  (%d Arten geprueft, keine Ausgabe = keine lief aus dem Bild)\n", (int)(sizeof arten/sizeof*arten));

  printf("\n── Die uebrigen Fahrzustaende ──\n");
  for (auto *z : {"idle","routing","paused","arrived","off_route","unavailable",""}) {
    Fall f{z, z, "turn_left", "x", "2026-09-15T14:32:00.000Z",
           87,80,1240,42.5,true,true,true,true,false};
    lauf(f, 320, 240, true);
  }

  printf("\n── Fehlende und kaputte Werte waehrend der Fahrt ──\n");
  Fall ohne{"alles unbekannt","navigating","turn_right","unknown","unknown",
            0,0,0,0,false,false,false,false,false};
  lauf(ohne, 320, 240, true);
  Fall etaMuell{"ETA unavailable","navigating","turn_right","Rechts",
                "unavailable",50,0,300,5,true,false,true,true,false};
  lauf(etaMuell, 320, 240, true);
  Fall schnell{"zu schnell","navigating","straight","Geradeaus",
               "2026-01-15T14:32:00.000Z",130,100,2500,180,true,true,true,true,true};
  lauf(schnell, 320, 240, true);
  Fall nah{"Rundung auf 10 m","navigating","turn_left","Links",
           "2026-09-15T14:32:00.000Z",30,50,483,1.2,true,true,true,true,false};
  lauf(nah, 320, 240, true);
  Fall lang{"sehr langer Text","navigating","turn_left",
            "Rechts abbiegen auf die Bundesstraße 27 Richtung Tübingen-Nord",
            "2026-09-15T14:32:00.000Z",50,50,900,9,true,true,true,true,false};
  lauf(lang, 320, 240, true);

  printf("\n── Andere Displaygroessen ──\n");
  int groessen[][2] = {{320,240},{240,240},{480,320},{170,320},{800,480},{128,128}};
  for (auto &g : groessen) {
    Fall f{"Fahrt","navigating","turn_left","Links abbiegen auf B27",
           "2026-09-15T14:32:00.000Z",87,80,1240,42.5,true,true,true,true,false};
    lauf(f, g[0], g[1], true);
  }

  // ── Harte Erwartungen ────────────────────────────────────────────────
  // Ohne sie druckt der Prueflauf nur und faellt nie durch.
  auto erwarte = [&](const char *name, const Fall &f, int w, int h,
                     std::vector<std::string> muss) {
    aufbauen(f);
    Display it(w,h); zeichne(it);
    for (auto &m : muss) {
      bool da = std::find(it.texte.begin(), it.texte.end(), m) != it.texte.end();
      if (!da) {
        printf("  FEHL %-26s erwartet \"%s\", bekam:", name, m.c_str());
        for (auto &t : it.texte) printf(" \"%s\"", t.c_str());
        printf("\n");
        fehler++;
      }
    }
    // Eine Anzeige darf niemals "nan" oder "inf" zeigen.
    for (auto &t : it.texte)
      if (t.find("nan") != std::string::npos || t.find("inf") != std::string::npos) {
        printf("  FEHL %-26s zeigt \"%s\"\n", name, t.c_str()); fehler++;
      }
  };

  printf("\n── Erwartete Anzeigetexte ──\n");

  // GENAU diese Texte, in dieser Reihenfolge. Nur auf Anwesenheit zu pruefen
  // uebersieht das Gegenteil: einen Wert, der da steht, obwohl er unbekannt
  // ist. Genau so ueberlebten drei Mutationen den ersten Anlauf.
  auto genau = [&](const char *name, const Fall &f, int w, int h,
                   std::vector<std::string> soll) {
    aufbauen(f);
    Display it(w,h); zeichne(it);
    if (it.texte != soll) {
      printf("  FEHL %-26s\n       soll:", name);
      for (auto &t : soll) printf(" \"%s\"", t.c_str());
      printf("\n       ist :");
      for (auto &t : it.texte) printf(" \"%s\"", t.c_str());
      printf("\n");
      fehler++;
    } else {
      printf("  OK   %-26s", name);
      for (auto &t : it.texte) printf(" \"%s\"", t.c_str());
      printf("\n");
    }
  };

  Fall sommer{"x","navigating","turn_left","Links abbiegen auf B27",
              "2026-09-15T14:32:00.000Z",87,80,1240,42.5,
              true,true,true,true,false,
              // Ohne Fahrzeuggrenze -- so wie bis 0.13.2.
              0,false,
              // Ohne Neigungswerte; das Tempo liegt ohnehin ueber der Schwelle.
              0,0,false};
  // Reihenfolge wie gezeichnet: Anweisung oben, Entfernung unter dem Pfeil,
  // dann die untere Zeile. Die RESTSTRECKE fehlt bewusst -- auf 240 runden
  // Bildpunkten ist kein Platz fuer ein fuenftes Feld, und sie ist von den
  // fuenf das entbehrlichste.
  genau("volle Fahrt, MESZ", sommer, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","80","16:32"});

  // ─── DIE FAHRZEUGGRENZE NEBEN DEM SCHILD (0.14.0) ────────────────────────
  // Ein Wohnmobil ueber 3,5 t darf weniger, als das Schild erlaubt. Die Zahl
  // steht DANEBEN und nicht im runden Zeichen: ein Verkehrszeichen behauptet,
  // dass es draussen steht -- und dieses stuende dort nicht.
  Fall schwer = sommer; schwer.limit_fz = 60; schwer.limit_fz_da = true;
  genau("Fahrzeuggrenze unter dem Schild: beide Zahlen", schwer, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","80","60","16:32"});

  // Der wichtigste Fall: unbegrenzte Autobahn, gar kein Schild. Vorher stand
  // hier NICHTS -- und `speeding` blieb bei 130 km/h aus.
  Fall autobahn = sommer;
  autobahn.limit_da = false;
  autobahn.limit_fz = 80; autobahn.limit_fz_da = true;
  autobahn.tempo = 130;
  genau("unbegrenzte Autobahn: nur die Fahrzeuggrenze", autobahn, 240,240,
        {"Links abbiegen auf B27","1.2 km","130","80","16:32"});

  // Die Gegenprobe: sagt die Fahrzeuggrenze dasselbe wie das Schild oder
  // mehr, bleibt sie weg. Eine Zahl, die dasselbe sagt wie das Zeichen
  // daneben, ist auf 240 runden Bildpunkten verschenkter Platz.
  Fall gleich = sommer; gleich.limit_fz = 80; gleich.limit_fz_da = true;
  genau("Fahrzeuggrenze gleich dem Schild: nur das Schild", gleich, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","80","16:32"});

  Fall hoeher = sommer; hoeher.limit_fz = 100; hoeher.limit_fz_da = true;
  genau("Fahrzeuggrenze ueber dem Schild: nur das Schild", hoeher, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","80","16:32"});

  Fall winter = sommer; winter.ankunft = "2026-01-15T14:32:00.000Z";
  genau("dieselbe Fahrt, MEZ", winter, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","80","15:32"});

  Fall meter = sommer; meter.mdist = 483;
  genau("Meter, auf 10 gerundet", meter, 240,240,
        {"Links abbiegen auf B27","480 m","87","80","16:32"});

  // Der wichtigste Fall: nichts bekannt. Es darf KEINE Zahl erscheinen --
  // kein Tempo, kein Tempolimit-Schild, keine Reststrecke.
  Fall leer{"x","navigating","turn_left","unknown","unknown",
            0,0,0,0,false,false,false,false,false};
  genau("nichts bekannt: nichts erfinden", leer, 240,240, {"","--","--:--"});

  // Kein Tempolimit in der Karte -> gar kein Schild. Ein Schild mit "0"
  // waere die Behauptung, hier gelte Tempo 0.
  Fall ohneLimit = sommer; ohneLimit.limit_da = false;
  genau("kein Tempolimit: kein Schild", ohneLimit, 240,240,
        {"Links abbiegen auf B27","1.2 km","87","16:32"});

  // Wird nicht navigiert, hat ein Manoeverpfeil nichts zu sagen.
  // ─── LANGE STRASSENNAMEN, UND DAS ß DARIN ───────────────────────────
  // Auf 240 runden Bildpunkten passen rund 25 Zeichen. Gekuerzt wird nach
  // BYTES -- und "ß", "ü", "ä" sind in UTF-8 ZWEI Bytes lang. Faellt der
  // Schnitt zwischen die beiden, entsteht kein Zeichen, sondern Bruch: die
  // Schrift zeigt dann ein Ersatzzeichen oder gar nichts. Deutsche
  // Strassennamen bestehen zu einem guten Teil aus solchen Zeichen.
  //
  // Geprueft wird die EIGENSCHAFT, nicht eine von Hand ausgerechnete Stelle:
  // was gezeichnet wird, muss gueltiges UTF-8 sein. Damit faellt jeder
  // Schnitt auf, egal wo er liegt -- ein Testfall mit einem geratenen Offset
  // haette genau den einen Fall geprueft, den ich mir ausgedacht habe.
  auto ist_utf8 = [](const std::string &t) {
    size_t i = 0;
    while (i < t.size()) {
      unsigned char c = t[i];
      size_t n = c < 0x80 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3
               : (c & 0xF8) == 0xF0 ? 4 : 0;
      if (n == 0 || i + n > t.size()) return false;
      for (size_t k = 1; k < n; k++)
        if ((static_cast<unsigned char>(t[i + k]) & 0xC0) != 0x80) return false;
      i += n;
    }
    return true;
  };

  printf("\n── Kürzen langer Namen: bleibt es gültiges UTF-8? ──\n");
  // Die Schnittstelle liegt FEST (nach der geschaetzten Zeichenzahl). Es
  // bringt also nichts, die Laenge der Eingabe zu variieren -- geschoben
  // werden muss das Mehrbyte-Zeichen ueber die Schnittstelle. Dafuer waechst
  // hier ein Vorsatz Buchstabe um Buchstabe.
  int kaputt = 0, geprueft = 0;
  for (int k = 0; k < 24; k++) {
    const std::string text =
        std::string(k, 'A') + " Bundesstraße 27 Richtung Tübingen-Grötzingen über Wüstenrot";
    s_zustand.state="navigating"; s_art.state="turn_left";
    s_anweisung.state=text; s_ankunft.state="2026-09-15T14:32:00.000Z";
    s_tempo.has=s_limit.has=s_mdist.has=true;
    s_tempo.state=87; s_limit.state=80; s_mdist.state=1240; s_schnell.state=false;
    Display it(240,240); zeichne(it);
    geprueft++;
    bool schlecht = false;
    for (auto &t : it.texte)
      if (!ist_utf8(t)) {
        if (kaputt < 3)
          printf("  FEHL Vorsatz %2d -> \"%s\" ist kein gültiges UTF-8\n", k, t.c_str());
        schlecht = true;
        break;
      }
    // Und es muss ueberhaupt gekuerzt werden: die Eingabe ist hier immer
    // deutlich laenger als der Platz. Ohne diese Zusicherung waere „gar nicht
    // kuerzen" ein gueltiges Ergebnis -- gueltiges UTF-8 ist es ja auch.
    const std::string &oben = it.texte.empty() ? text : it.texte[0];
    if (oben.size() > 28) {
      if (kaputt < 3)
        printf("  FEHL Vorsatz %2d -> \"%s\" (%zu Bytes) wurde nicht gekürzt\n",
               k, oben.c_str(), oben.size());
      schlecht = true;
    }
    if (schlecht) kaputt++;
  }
  if (kaputt > 0) {
    printf("  %d von %d Verschiebungen erzeugen Bruch\n", kaputt, geprueft);
    fehler++;
  } else {
    printf("  OK   alle %d Verschiebungen bleiben gültiges UTF-8\n", geprueft);
  }

  // ─── OHNE ROUTE ZEIGT DAS GERAET DAS TEMPO ──────────────────────────────
  // Gemeldet ueber die Entwicklerwerkzeuge: bei `nav_state: idle` standen
  // `sensor.yapaja_speed` und `sensor.yapaja_altitude` auf "unknown",
  // waehrend `device_tracker.yapaja_vehicle` im selben Augenblick eine
  // Position auf zehn Nachkommastellen fuehrte. Seit 0.13.1 holt der Kern
  // beides aus dem GPS, sobald ein Fix da ist.
  //
  // Damit hat ein fest verbautes Display auch ohne Route etwas zu zeigen --
  // und zwar das, wofuer man im Fahrzeug ueberhaupt auf einen Tacho sieht.
  // Der Zustandstext bleibt darunter stehen: er ist die Nebenauskunft.
  // ─── DIE DIGITALE WASSERWAAGE (0.15.0) ──────────────────────────────────
  // Unter 2 km/h wechselt die Anzeige auf eine runde Libelle. Gemessen wird
  // an den TEXTEN: die Blase selbst ist eine Zeichnung, aber die Zahlen und
  // der Satz „steht gerade" sagen eindeutig, welcher Zweig lief.
  Fall parkt = sommer;
  parkt.tempo = 0.4f; parkt.tempo_da = true;
  parkt.lr = -1.2f; parkt.vh = -0.6f; parkt.neigung_da = true;
  genau("unter 2 km/h: Wasserwaage statt Navigation", parkt, 240,240,
        {"L/R -1.2°", "V/H -0.6°"});

  // Innerhalb der Toleranz kommt der Satz dazu -- und NUR dann.
  Fall eben = parkt; eben.lr = 0.2f; eben.vh = -0.1f;
  // Die Reihenfolge ist die ZEICHENreihenfolge, nicht die von oben nach
  // unten: der Satz steht ueber der Mitte, wird aber zuletzt gemalt.
  genau("gerade genug: sagt es auch", eben, 240,240,
        {"L/R +0.2°", "V/H -0.1°", "steht gerade"});

  // ─── OHNE NEIGUNGSWERTE KEINE BLASE ─────────────────────────────────────
  // Eine Blase in der Mitte hiesse „steht gerade". Fehlen die Werte, waere
  // das eine Behauptung -- und zwar die beruhigende, bei der niemand
  // nachsieht.
  Fall ohne_neigung = parkt; ohne_neigung.neigung_da = false;
  genau("ohne Neigungswerte: sagt WAS fehlt", ohne_neigung, 240,240,
        {"Keine Neigungswerte", "Sensoren pruefen"});

  // ─── BEI UNBEKANNTEM TEMPO WAEHREND DER NAVIGATION: KEINE LIBELLE ───────
  // Faellt auf der Autobahn das GPS aus, laeuft die Navigation weiter -- und
  // dann bleibt die Route stehen.
  Fall tempo_weg = parkt; tempo_weg.tempo_da = false;
  genau("Tempo unbekannt, aber navigierend: KEINE Wasserwaage", tempo_weg, 240,240,
        {"Links abbiegen auf B27","1.2 km","80","16:32"});

  // ─── DER GEMELDETE FALL ─────────────────────────────────────────────────
  // Mit Foto: das Geraet zeigte „Kein Wert aus Home Assistant", obwohl die
  // Neigungswerte anlagen. `sensor.yapaja_speed` hatte keinen Wert, und die
  // erste Fassung verlangte ein BEKANNTES Tempo -- also fiel alles durch bis
  // zur Fahrzustandsmeldung.
  //
  // Die Wasserwaage haengt an einem ganz anderen Geraet. Sie von Yapaias
  // Tempowert abhaengig zu machen war die falsche Kopplung.
  Fall geparkt_ohne_tempo = parkt;
  geparkt_ohne_tempo.tempo_da = false;
  geparkt_ohne_tempo.zustand = "";
  genau("kein Tempo, keine Navigation, aber Neigung: WASSERWAAGE",
        geparkt_ohne_tempo, 240,240, {"L/R -1.2°", "V/H -0.6°"});

  // Dasselbe bei `idle` -- der Normalfall nach dem Abstellen.
  Fall geparkt_idle = geparkt_ohne_tempo; geparkt_idle.zustand = "idle";
  genau("idle ohne Tempo, mit Neigung: WASSERWAAGE", geparkt_idle, 240,240,
        {"L/R -1.2°", "V/H -0.6°"});

  // ─── UND DIE GEGENPROBE ─────────────────────────────────────────────────
  // Ein Geraet OHNE Neigungssensoren darf bei unbekanntem Tempo nicht
  // dauerhaft eine Meldung ueber Sensoren bringen, die es gar nicht hat.
  // Dort gilt weiter die alte Anzeige.
  Fall ohne_alles = geparkt_ohne_tempo; ohne_alles.neigung_da = false;
  genau("kein Tempo, keine Neigung: die alte Meldung, nicht die Libelle",
        ohne_alles, 240,240,
        {"Kein Wert aus Home Assistant", "Entitaet pruefen: Filter \"yapa\""});

  // Die Gegenprobe zur Schwelle: knapp darueber laeuft die Navigation weiter.
  Fall rollt = parkt; rollt.tempo = 5.0f;
  genau("ueber der Schwelle: Navigation", rollt, 240,240,
        {"Links abbiegen auf B27","1.2 km","5","80","16:32"});

  Fall ruhe = sommer; ruhe.zustand = "idle";
  genau("idle mit Tempo: Tacho gross, Lage klein", ruhe, 240,240,
        {"87", "km/h", "Keine Route"});

  // Die Gegenprobe. Ohne Tempowert bleibt es beim blossen Zustandstext --
  // sonst stuende dort eine Null, und eine Null ist die Behauptung
  // „Stillstand" und nicht „weiss ich nicht".
  Fall ruhe_ohne = sommer; ruhe_ohne.zustand = "idle"; ruhe_ohne.tempo_da = false;
  genau("idle ohne Tempo: nur die Lage melden", ruhe_ohne, 240,240, {"Keine Route"});

  // ─── DER ZUSTAND, DEN DIESE PRUEFUNG NICHT KANNTE ────────────────────────
  // Gemeldet mit Foto: das Geraet zeigte „Keine Verbindung", waehrend es in
  // ESPHome als „Geraet online" mit IP-Adresse dastand. Beides stimmte — die
  // Verbindung war da, nur die ENTITAET lieferte keinen Wert.
  //
  // Diese Pruefung hatte Faelle fuer `idle` und `off_route`, aber keinen fuer
  // den LEEREN Zustand. Genau der ist beim ersten Einschalten der Normalfall:
  // solange Home Assistant nichts geschickt hat, ist der Text leer.
  //
  // Der alte Satz schickte an den Router. Der neue sagt, was fehlt und wo man
  // nachsieht.
  Fall stumm = sommer; stumm.zustand = "";
  genau("leerer Zustand: sagt WAS fehlt, nicht -keine Verbindung-", stumm, 240,240,
        {"Kein Wert aus Home Assistant", "Entitaet pruefen: Filter \"yapa\""});
  Fall unbekannt = sommer; unbekannt.zustand = "unavailable";
  genau("unavailable: derselbe Fall", unbekannt, 240,240,
        {"Kein Wert aus Home Assistant", "Entitaet pruefen: Filter \"yapa\""});
  Fall weg = sommer; weg.zustand = "off_route";
  genau("off_route mit Tempo", weg, 240,240, {"87", "km/h", "Abseits der Route"});

  // ─── "unknown" IST KEIN ZUSTAND, SONDERN EIN FEHLENDER WERT ─────────────
  // Diese Pruefung kannte den leeren Zustand und "unavailable", aber nicht
  // "unknown" -- und genau den schickt Home Assistant fuer einen Sensor ohne
  // Wert. Die Zeichenroutine kannte ihn ebenfalls nicht und haette daraus
  // die feste Aussage „Keine Route" gemacht: das Geraet haette behauptet, es
  // sei alles in Ordnung und es liege nur nichts an, waehrend es in
  // Wahrheit gar nichts wusste.
  //
  // Dass dieselbe Datei beim Anweisungstext SEHR WOHL auf "unknown" prueft,
  // macht es nicht besser, sondern zeigt nur, dass es an einer Stelle
  // vergessen wurde.
  Fall nichts_bekannt = sommer; nichts_bekannt.zustand = "unknown";
  genau("unknown: kein Zustand, sondern ein fehlender Wert", nichts_bekannt, 240,240,
        {"Kein Wert aus Home Assistant", "Entitaet pruefen: Filter \"yapa\""});

  // ─── WENN GAR NICHTS ANKOMMT ────────────────────────────────────────────
  // Gemeldet, zum zweiten Mal: „Das Display vom esp zeigt immer noch kein
  // Wert aus HA." -- waehrend in Home Assistant Werte standen.
  //
  // Die Rueckfrage des Betreibers war die richtige: kommen sie ueberhaupt
  // beim ESP an? Genau das liess sich nicht nachsehen. Die alte Meldung
  // nannte EINE moegliche Ursache (den Entitaetsnamen), sagte aber nicht,
  // welche der Entitaeten betroffen ist -- und schon gar nicht, ob ueberhaupt
  // eine ankommt.
  //
  // Das sind zwei sehr verschiedene Lagen: ein falscher Name betrifft EINE
  // Entitaet, eine fehlende Einbindung in Home Assistant ALLE. Die zweite
  // war von der ersten nicht zu unterscheiden.
  printf("\n── Diagnose: kommt ueberhaupt etwas an? ──\n");

  // Nichts kommt an: kein Zustand, kein Text, kein Zahlenwert, keine Neigung.
  // Benannt und nicht nach Position: `Fall` hat neunzehn Felder, viele davon
  // `bool` und `float` nebeneinander. Eine Zeile nach Position ist dort nicht
  // zu lesen -- und beim Zufuegen des erzwungenen Modus ist genau das prompt
  // verrutscht. Alles, was hier nicht genannt wird, ist null bzw. `false`,
  // und das IST hier die Aussage: es kommt nichts an.
  Fall taub{};
  taub.name = "x";
  taub.zustand = ""; taub.art = "turn_left";
  taub.anweisung = "unknown"; taub.ankunft = "unknown";
  genau("nichts kommt an: die Liste statt der Sackgasse", taub, 240,240,
        {"Diagnose",
         "Tempo","--", "Limit","--", "Limit Fzg","--", "Entfernung","--",
         "Zustand","--", "Anweisung","--", "Neig L/R","--", "Neig V/H","--",
         "Nichts kommt an", "ESPHome in HA einbinden"});

  // ─── DIE GEGENPROBE ─────────────────────────────────────────────────────
  // Sie ist hier das Wichtigere. Die Liste darf NICHT erscheinen, sobald
  // irgendetwas ankommt -- sonst waere sie keine Diagnose, sondern die neue
  // Dauer-Anzeige, und die Navigationsanzeige damit tot.
  //
  // `stumm` hat einen leeren Zustand, aber Tempo, Limit und Entfernung. Das
  // ist der ALTE Fall, und er muss unveraendert die alte Meldung zeigen.
  Fall stumm_aber_tempo = sommer; stumm_aber_tempo.zustand = "";
  genau("ein Wert reicht: die alte Meldung, nicht die Liste", stumm_aber_tempo,
        240,240,
        {"Kein Wert aus Home Assistant", "Entitaet pruefen: Filter \"yapa\""});

  // Und die Umkehrung: NUR die Neigung kommt an, sonst nichts. Auch das ist
  // „etwas kommt an" -- die Neigungssensoren haengen an einem anderen Geraet,
  // und dass DIE ankommen, ist die entscheidende Auskunft: dann ist die
  // Einbindung in Ordnung und es liegt an Yapaias Entitaetsnamen.
  Fall nur_neigung = taub; nur_neigung.neigung_da = true;
  nur_neigung.lr = 1.5f; nur_neigung.vh = -0.5f;
  genau("nur die Neigung kommt an: Wasserwaage, nicht Diagnose", nur_neigung,
        240,240,
        {"L/R +1.5\u00b0", "V/H -0.5\u00b0"});

  // ─── DIE BEIDEN SCHALTER ────────────────────────────────────────────────
  // Gewuenscht: einer, der zwischen Libelle und Fahrzeugansicht umschaltet,
  // und einer, der die Waage unabhaengig vom Tempo oeffnet -- „parallel zu
  // der Geschwindigkeit", um ihn spaeter an den Rueckwaertsgang zu haengen.
  printf("\n── Die beiden Schalter ──\n");

  Fall schalter_parkt{};
  schalter_parkt.name = "x";
  schalter_parkt.zustand = "idle"; schalter_parkt.art = "turn_left";
  schalter_parkt.anweisung = "x"; schalter_parkt.ankunft = "2026-09-15T14:32:00.000Z";
  schalter_parkt.tempo = 0; schalter_parkt.tempo_da = true;
  schalter_parkt.lr = 1.0f; schalter_parkt.vh = -1.5f; schalter_parkt.neigung_da = true;

  // Die Libelle ist die Vorgabe -- bestehende Geraete sollen sich nach dem
  // Update nicht anders verhalten, als sie es vorher taten.
  genau("Vorgabe bleibt die Libelle", schalter_parkt, 240,240,
        {"L/R +1.0\u00b0", "V/H -1.5\u00b0"});

  Fall als_fahrzeug = schalter_parkt; als_fahrzeug.fahrzeug = true;
  genau("Schalter an: die Fahrzeugansicht mit Millimetern", als_fahrzeug, 240,240,
        {"V/H -106 mm  -1.5\u00b0", "L/R +32 mm  +1.0\u00b0"});

  // ─── WAS DIE MILLIMETER WERT SIND ───────────────────────────────────────
  // Sie sind der eigentliche Zweck dieser Ansicht: ein Grad sagt niemandem,
  // wie dick der Keil sein muss. Deshalb steht hier eine EXAKTE Zahl und
  // keine Obergrenze -- eine Millimeterangabe, die nur ungefaehr stimmt,
  // waere schlimmer als gar keine, weil man nach ihr greift.
  //
  //   -1.5 Grad ueber 4035 mm Radstand  ->  tan(1.5 Grad) * 4035 = -105.6
  //   +1.0 Grad ueber 1810 mm Spurweite ->  tan(1.0 Grad) * 1810 = +31.6
  //
  // Faende jemand die Vorzeichen oder die Bezugsmasse vertauscht, faellt es
  // genau hier auf und nicht erst neben dem Fahrzeug.

  // Die Gegenprobe zur Rechnung: der doppelte Winkel ergibt rund die
  // doppelte Hoehe. Ohne sie waeren die Zahlen oben auch dann gruen, wenn
  // die Millimeter eine feste Zahl waeren.
  Fall doppelt = als_fahrzeug; doppelt.vh = -3.0f;
  genau("doppelter Winkel, doppelte Hoehe", doppelt, 240,240,
        {"V/H -211 mm  -3.0\u00b0", "L/R +32 mm  +1.0\u00b0"});

  // Steht es gerade, sagt es das -- in BEIDEN Ansichten. Ein Schalter, hinter
  // dem dieselbe Lage anders beurteilt wird, waere eine Falle.
  Fall eben_fz = als_fahrzeug; eben_fz.lr = 0.1f; eben_fz.vh = -0.2f;
  genau("gerade: die Fahrzeugansicht sagt es auch", eben_fz, 240,240,
        {"V/H -14 mm  -0.2\u00b0", "L/R +3 mm  +0.1\u00b0", "steht gerade"});
  Fall eben_lib = eben_fz; eben_lib.fahrzeug = false;
  genau("gerade: die Libelle sagt dasselbe", eben_lib, 240,240,
        {"L/R +0.1\u00b0", "V/H -0.2\u00b0", "steht gerade"});

  // ─── DER ERZWINGEN-SCHALTER ─────────────────────────────────────────────
  // Er ist fuer das Rangieren gedacht, und beim Rangieren STEHT das Fahrzeug
  // nicht -- es faehrt langsam rueckwaerts. Genau deshalb kommt er neben die
  // Tempobedingung und nicht an ihre Stelle.
  Fall faehrt{};
  faehrt.name = "x";
  faehrt.zustand = "navigating"; faehrt.art = "turn_left";
  faehrt.anweisung = "Links abbiegen"; faehrt.ankunft = "2026-09-15T14:32:00.000Z";
  faehrt.tempo = 8; faehrt.tempo_da = true;
  faehrt.mdist = 300; faehrt.mdist_da = true;
  faehrt.lr = 1.0f; faehrt.vh = -1.5f; faehrt.neigung_da = true;

  // Ohne Schalter: die Navigation laeuft weiter. Das ist die Gegenprobe --
  // ein Schalter, der nichts aendert, weil ohnehin immer die Waage kaeme,
  // waere keiner.
  genau("8 km/h ohne Schalter: Navigation", faehrt, 240,240,
        {"Links abbiegen", "300 m", "8", "16:32"});

  Fall rangiert = faehrt; rangiert.erzwingen = true;
  genau("8 km/h MIT Schalter: trotzdem die Waage", rangiert, 240,240,
        {"L/R +1.0\u00b0", "V/H -1.5\u00b0"});

  // Und beide Schalter zusammen -- sie sind voneinander unabhaengig.
  Fall rangiert_fz = rangiert; rangiert_fz.fahrzeug = true;
  genau("beide Schalter: erzwungen UND als Fahrzeug", rangiert_fz, 240,240,
        {"V/H -106 mm  -1.5\u00b0", "L/R +32 mm  +1.0\u00b0"});

  printf("\n── Welcher Pfeil bei welcher Manoeverart ──\n");
  // `ManeuverType` ist in types.ts ausdruecklich `| string`: Valhalla liefert
  // auch slight_/sharp_/ramp_. Wer auf genaue Gleichheit prueft, zeigt bei
  // all diesen einen Geradeaus-Pfeil -- also genau die falsche Richtung.
  auto pfeil = [&](const char *art, const char *soll_formen,
                   const char *soll_richtung) {
    // ─── DIE FUENFTE AUFBAU-STELLE, UND DIE GEFAEHRLICHSTE ──────────────
    // Sie setzte die Bauteile selbst und liess dabei alles ungenannte
    // stehen -- also den Zustand des VORIGEN Falls. Solange es nur Sensoren
    // gab, fiel das nicht auf: der vorige Fall setzte sie ja auch.
    //
    // Mit den beiden Schaltern fiel es sofort auf: der letzte Fall davor
    // liess „Waage als Fahrzeug" an, und jeder Pfeiltest zeichnete
    // daraufhin ein Fahrzeug. Sechzehn Fehlschlaege auf einen Schlag --
    // und zwar in Pruefungen, die mit Schaltern nichts zu tun haben.
    //
    // Deshalb geht auch diese Stelle jetzt ueber `aufbauen`: was ein Fall
    // nicht nennt, ist danach aus und nicht „was zuletzt galt".
    Fall f{};
    f.name = "x";
    f.zustand = "navigating"; f.art = art;
    f.anweisung = "x"; f.ankunft = "2026-09-15T14:32:00.000Z";
    f.tempo = 87;    f.tempo_da = true;
    f.limit = 80;    f.limit_da = true;
    f.mdist = 1240;  f.mdist_da = true;
    f.rest = 42.5f;  f.rest_da = true;
    aufbauen(f);
    Display it(240,240); zeichne(it);
    std::string vorne = it.pfeil_fertig ? it.pfeil_formen : it.formen;
    // Wohin zeigt er? Der Pfeilmittelpunkt ist B/5; ragt die Zeichnung
    // deutlich weiter nach links als nach rechts, zeigt er nach links.
    const int px = 240 / 2;   // der Pfeil sitzt jetzt mittig
    const int nach_links  = px - it.pminx;
    const int nach_rechts = it.pmaxx - px;
    const char *richtung = "gerade";
    if (nach_links > nach_rechts * 3 / 2) richtung = "links";
    else if (nach_rechts > nach_links * 3 / 2) richtung = "rechts";
    bool gut = vorne == soll_formen && std::string(richtung) == soll_richtung;
    printf("  %s %-22s -> %-5s %-7s (soll %s %s)\n", gut?"OK  ":"FEHL", art,
           vorne.c_str(), richtung, soll_formen, soll_richtung);
    if (!gut) fehler++;
  };
  const char *GERADE="RT", *ABBIEGEN="RRT", *WENDEN="RRRT", *KREISEL="ORRT";
  pfeil("turn_left", ABBIEGEN, "links");    pfeil("turn_right", ABBIEGEN, "rechts");
  pfeil("slight_left", ABBIEGEN, "links");  pfeil("sharp_right", ABBIEGEN, "rechts");
  pfeil("ramp_left", ABBIEGEN, "links");    pfeil("exit_right", ABBIEGEN, "rechts");
  pfeil("uturn_left", WENDEN, "links");     pfeil("uturn_right", WENDEN, "rechts");
  pfeil("roundabout_enter", KREISEL, "rechts"); pfeil("roundabout_exit", KREISEL, "rechts");
  pfeil("straight", GERADE, "gerade");      pfeil("continue", GERADE, "gerade");
  pfeil("merge", GERADE, "gerade");         pfeil("destination", GERADE, "gerade");
  pfeil("", GERADE, "gerade");              pfeil("voellig_unbekannt", GERADE, "gerade");

  printf("\n%d Fehler\n", fehler);
  return fehler ? 1 : 0;
#endif
}
