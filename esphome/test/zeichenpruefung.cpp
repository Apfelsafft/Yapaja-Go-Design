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
  int pminx=1<<30, pmaxx=-(1<<30);  // nur die Pfeilformen
  std::string formen;  // R=Rechteck T=Dreieck O=Ring C=Kreis L=Linie
  bool zeichne_protokoll = false;

  Display(int w_, int h_) : w(w_), h(h_) {}
  int get_width() { return w; }
  int get_height() { return h; }

  void punkt(int x, int y) {
    minx=std::min(minx,x); maxx=std::max(maxx,x);
    miny=std::min(miny,y); maxy=std::max(maxy,y);
    aufrufe++;
  }
  // Wie `punkt`, aber zaehlt zusaetzlich in die Pfeil-Box -- solange die
  // Trennlinie noch nicht gezeichnet ist. Nur Formen rufen das auf: der
  // Hintergrund faerbt das ganze Bild, und der Anweisungstext steht rechts
  // vom Pfeil. Beides in die Box zu nehmen machte jede Richtung zu "rechts".
  void spunkt(int x, int y) {
    if (formen.find('L') == std::string::npos) {
      pminx=std::min(pminx,x); pmaxx=std::max(pmaxx,x);
    }
    punkt(x, y);
  }
  void fill(Color) { punkt(0,0); punkt(w-1,h-1); }
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
    punkt(x,y); texte.push_back(t);
  }
  void printf(int x,int y,BaseFont*f,Color c,TextAlign a,const char*fmt,...){
    char buf[256]; va_list ap; va_start(ap,fmt);
    vsnprintf(buf,sizeof buf,fmt,ap); va_end(ap);
    punkt(x,y); texte.push_back(buf);
  }
};

} // namespace esphome
using namespace esphome;

// ─── Die Objekte, die `id(...)` im echten Lambda liefert ────────────────────
static BaseFont f_xl{46}, f_l{34}, f_m{19}, f_s{14};
static Color k_hintergrund{0x10,0x14,0x18}, k_text{0xF2,0xF5,0xF7},
             k_gedaempft{0x8A,0x94,0x9E}, k_pfeil{0x4E,0xA1,0xFF},
             k_warnung{0xFF,0x4D,0x4D}, k_gut{0x3D,0xDC,0x84}, k_schild{255,255,255};
static sensor::Sensor s_tempo, s_limit, s_mdist, s_rest;
static binary_sensor::BinarySensor s_schnell;
static text_sensor::TextSensor s_anweisung, s_art, s_zustand, s_ankunft;

// `id(x)` liefert in ESPHome das OBJEKT (Punktschreibweise), keinen Zeiger.
#define id(x) _id_##x
#define _id_font_xl (&f_xl)
#define _id_font_l  (&f_l)
#define _id_font_m  (&f_m)
#define _id_font_s  (&f_s)
#define _id_c_hintergrund k_hintergrund
#define _id_c_text        k_text
#define _id_c_gedaempft   k_gedaempft
#define _id_c_pfeil       k_pfeil
#define _id_c_warnung     k_warnung
#define _id_c_gut         k_gut
#define _id_c_schild      k_schild
#define _id_yapaja_tempo               s_tempo
#define _id_yapaja_tempolimit          s_limit
#define _id_yapaja_manoever_entfernung s_mdist
#define _id_yapaja_reststrecke         s_rest
#define _id_yapaja_zu_schnell          s_schnell
#define _id_yapaja_anweisung           s_anweisung
#define _id_yapaja_manoever_art        s_art
#define _id_yapaja_fahrzustand         s_zustand
#define _id_yapaja_ankunft             s_ankunft

static void zeichne(Display &it) {
#include "lambda_body.inc"  // wird von run.mjs erzeugt
}

// ─── Die Faelle ────────────────────────────────────────────────────────────
struct Fall {
  const char *name;
  const char *zustand, *art, *anweisung, *ankunft;
  float tempo, limit, mdist, rest; bool tempo_da, limit_da, mdist_da, rest_da;
  bool schnell;
};

static int fehler = 0;

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
  if (raus) {
    printf("  FEHL %-22s %dx%d  Bereich x[%d..%d] y[%d..%d]\n",
           f.name, w, h, it.minx, it.maxx, it.miny, it.maxy);
    fehler++;
  } else if (zeige) {
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
    s_limit.state=f.limit; s_limit.has=f.limit_da; s_mdist.state=f.mdist;
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
              true,true,true,true,false};
  genau("volle Fahrt, MESZ", sommer, 320,240,
        {"1.2 km","Links abbiegen auf B27","87","km/h","80","16:32","noch 42.5 km"});

  Fall winter = sommer; winter.ankunft = "2026-01-15T14:32:00.000Z";
  genau("dieselbe Fahrt, MEZ", winter, 320,240,
        {"1.2 km","Links abbiegen auf B27","87","km/h","80","15:32","noch 42.5 km"});

  Fall meter = sommer; meter.mdist = 483;
  genau("Meter, auf 10 gerundet", meter, 320,240,
        {"480 m","Links abbiegen auf B27","87","km/h","80","16:32","noch 42.5 km"});

  // Der wichtigste Fall: nichts bekannt. Es darf KEINE Zahl erscheinen --
  // kein Tempo, kein Tempolimit-Schild, keine Reststrecke.
  Fall leer{"x","navigating","turn_left","unknown","unknown",
            0,0,0,0,false,false,false,false,false};
  genau("nichts bekannt: nichts erfinden", leer, 320,240, {"--","","--:--"});

  // Kein Tempolimit in der Karte -> gar kein Schild. Ein Schild mit "0"
  // waere die Behauptung, hier gelte Tempo 0.
  Fall ohneLimit = sommer; ohneLimit.limit_da = false;
  genau("kein Tempolimit: kein Schild", ohneLimit, 320,240,
        {"1.2 km","Links abbiegen auf B27","87","km/h","16:32","noch 42.5 km"});

  // Wird nicht navigiert, hat ein Manoeverpfeil nichts zu sagen.
  Fall ruhe = sommer; ruhe.zustand = "idle";
  genau("idle: nur die Lage melden", ruhe, 320,240, {"Keine Route"});
  Fall weg = sommer; weg.zustand = "off_route";
  genau("off_route", weg, 320,240, {"Abseits der Route"});

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
    Display it(320,240); zeichne(it);
    std::string vorne = it.formen.substr(0, it.formen.find('L'));
    // Wohin zeigt er? Der Pfeilmittelpunkt ist B/5; ragt die Zeichnung
    // deutlich weiter nach links als nach rechts, zeigt er nach links.
    const int px = 320 / 5;
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
