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
};

static int fehler = 0;

static bool rund_pruefen = true;

static void lauf(const Fall &f, int w, int h, bool zeige) {
  s_zustand.state = f.zustand; s_art.state = f.art;
  s_anweisung.state = f.anweisung; s_ankunft.state = f.ankunft;
  // Was Home Assistant fuer "weiss ich nicht" schickt, ist NaN -- nicht 0.
  // Mit 0 waere jede Pruefung auf die NaN-Absicherung wirkungslos gewesen.
  auto setze = [](sensor::Sensor &s, float wert, bool da) {
    s.has = da; s.state = da ? wert : NAN;
  };
  setze(s_tempo, f.tempo, f.tempo_da);
  setze(s_limit, f.limit, f.limit_da);
  setze(s_limit_fz, f.limit_fz, f.limit_fz_da);
  setze(s_lr, f.lr, f.neigung_da);
  setze(s_vh, f.vh, f.neigung_da);
  setze(s_mdist, f.mdist, f.mdist_da);
  setze(s_rest,  f.rest,  f.rest_da);
  s_schnell.state = f.schnell;

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
    s_zustand.state=f.zustand; s_art.state=f.art; s_anweisung.state=f.anweisung;
    s_ankunft.state=f.ankunft; s_tempo.state=f.tempo; s_tempo.has=f.tempo_da;
    s_limit.state=f.limit; s_limit.has=f.limit_da;
    s_limit_fz.state=f.limit_fz; s_limit_fz.has=f.limit_fz_da;
    s_mdist.state=f.mdist;
    s_mdist.has=f.mdist_da; s_rest.state=f.rest; s_rest.has=f.rest_da;
    s_schnell.state=f.schnell;
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
    s_zustand.state=f.zustand; s_art.state=f.art; s_anweisung.state=f.anweisung;
    s_ankunft.state=f.ankunft;
    s_tempo.has=f.tempo_da; s_tempo.state=f.tempo_da?f.tempo:NAN;
    s_limit.has=f.limit_da; s_limit.state=f.limit_da?f.limit:NAN;
    // ─── DIESE ZEILE HAT GEFEHLT ──────────────────────────────────────────
    // `genau` baut die Sensoren SELBST auf, statt `lauf` zu benutzen -- es
    // ist die dritte Stelle in dieser Datei, die dasselbe tut. Beim Zufuegen
    // der Fahrzeuggrenze war sie die einzige, die vergessen wurde, und die
    // Folge war kein Fehler, sondern Stille: der Sensor blieb leer, die Zahl
    // wurde nie gezeichnet, und der Test „Fahrzeuggrenze gleich dem Schild"
    // bestand trotzdem -- weil auch er nichts erwartete.
    //
    // Ein Test, der aus dem falschen Grund gruen ist, sieht aus wie einer,
    // der stimmt.
    s_limit_fz.has=f.limit_fz_da; s_limit_fz.state=f.limit_fz_da?f.limit_fz:NAN;
    s_lr.has=f.neigung_da; s_lr.state=f.neigung_da?f.lr:NAN;
    s_vh.has=f.neigung_da; s_vh.state=f.neigung_da?f.vh:NAN;
    s_mdist.has=f.mdist_da; s_mdist.state=f.mdist_da?f.mdist:NAN;
    s_rest.has=f.rest_da;   s_rest.state=f.rest_da?f.rest:NAN;
    s_schnell.state=f.schnell;
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

  // ─── BEI UNBEKANNTEM TEMPO BLEIBT ES BEI DER NAVIGATION ─────────────────
  // Unbekannt heisst NICHT „vermutlich steht es". Sonst erschiene die
  // Wasserwaage mitten auf der Autobahn, sobald das GPS aussetzt.
  Fall tempo_weg = parkt; tempo_weg.tempo_da = false;
  genau("Tempo unbekannt: KEINE Wasserwaage", tempo_weg, 240,240,
        {"Links abbiegen auf B27","1.2 km","80","16:32"});

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

  printf("\n── Welcher Pfeil bei welcher Manoeverart ──\n");
  // `ManeuverType` ist in types.ts ausdruecklich `| string`: Valhalla liefert
  // auch slight_/sharp_/ramp_. Wer auf genaue Gleichheit prueft, zeigt bei
  // all diesen einen Geradeaus-Pfeil -- also genau die falsche Richtung.
  auto pfeil = [&](const char *art, const char *soll_formen,
                   const char *soll_richtung) {
    s_zustand.state="navigating"; s_art.state=art;
    s_anweisung.state="x"; s_ankunft.state="2026-09-15T14:32:00.000Z";
    s_tempo.has=s_limit.has=s_mdist.has=s_rest.has=true;
    s_tempo.state=87; s_limit.state=80; s_mdist.state=1240; s_rest.state=42.5;
    s_schnell.state=false;
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
}
