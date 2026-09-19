// Zeichnet die Routine in ein echtes Pixelfeld und gibt es als ASCII aus.
//
// ─── WOFUER DAS NEBEN `zeichenpruefung.cpp` STEHT ──────────────────────────
// Die Zeichenpruefung merkt sich nur die aeussersten Punkte und die Texte.
// Damit faengt sie Tippfehler, falsche Argumentzahlen und Zeichnungen, die
// aus dem Bild laufen -- aber nicht die Frage, ob ein Fahrzeug wie ein
// Fahrzeug AUSSIEHT. Genau daran sind hier schon zwei Symbole gescheitert
// (Leitkegel, Muelltonne), und beide Male hat erst das Hinsehen es gezeigt.
//
// Dieses Werkzeug ist kein Test: es faellt nie durch. Es ist zum Ansehen.
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
namespace sensor { struct Sensor { bool has = true; float state = 0;
  bool has_state() const { return has; } }; }
namespace text_sensor { struct TextSensor { std::string state; }; }
namespace binary_sensor { struct BinarySensor { bool state = false; }; }
namespace switch_ { struct Switch { bool state = false; }; }

struct ESPTime {
  uint8_t second=0, minute=0, hour=0, day_of_week=0, day_of_month=0;
  uint16_t day_of_year=0; uint8_t month=0; uint16_t year=0;
  bool is_dst=false; time_t timestamp=0;
  void recalc_timestamp_utc(bool = true) {
    struct tm t{}; t.tm_year=year-1900; t.tm_mon=month-1; t.tm_mday=day_of_month;
    t.tm_hour=hour; t.tm_min=minute; t.tm_sec=second; timestamp = timegm(&t);
  }
  static ESPTime from_epoch_local(time_t epoch) {
    struct tm l{}; localtime_r(&epoch, &l);
    ESPTime e; e.year=l.tm_year+1900; e.month=l.tm_mon+1; e.day_of_month=l.tm_mday;
    e.hour=l.tm_hour; e.minute=l.tm_min; e.second=l.tm_sec; e.timestamp=epoch; return e;
  }
};

// Die Uhr aus Home Assistant. Setzbar, damit ein Bild bei jedem Lauf
// dasselbe zeigt -- gegen `time(nullptr)` gerechnet waere die Restzeit
// jedes Mal eine andere Zahl.
struct RealTimeClock { ESPTime jetzt{}; ESPTime now() const { return jetzt; } };

struct Display {
  int w,h; std::vector<char> feld;
  Display(int w_,int h_):w(w_),h(h_),feld(w_*h_,' ') {}
  int get_width(){return w;} int get_height(){return h;}
  void setz(int x,int y,char c){ if(x>=0&&y>=0&&x<w&&y<h) feld[y*w+x]=c; }
  void fill(Color){}
  void line(int x1,int y1,int x2,int y2,Color=COLOR_ON){
    int n=std::max(abs(x2-x1),abs(y2-y1)); if(n==0){setz(x1,y1,'.');return;}
    for(int i=0;i<=n;i++) setz(x1+(x2-x1)*i/n, y1+(y2-y1)*i/n, '.');
  }
  void horizontal_line(int x,int y,int width,Color=COLOR_ON){ for(int i=0;i<width;i++) setz(x+i,y,'.'); }
  void vertical_line(int x,int y,int height,Color=COLOR_ON){ for(int i=0;i<height;i++) setz(x,y+i,'.'); }
  void rectangle(int x,int y,int ww,int hh,Color=COLOR_ON){
    horizontal_line(x,y,ww); horizontal_line(x,y+hh-1,ww);
    vertical_line(x,y,hh); vertical_line(x+ww-1,y,hh);
  }
  void filled_rectangle(int x,int y,int ww,int hh,Color=COLOR_ON){
    for(int j=0;j<hh;j++) for(int i=0;i<ww;i++) setz(x+i,y+j,'#');
  }
  void circle(int cx,int cy,int r,Color=COLOR_ON){
    for(int a=0;a<360;a+=3) setz(cx+(int)(r*cosf(a*3.14159f/180)), cy+(int)(r*sinf(a*3.14159f/180)), ':');
  }
  void filled_circle(int cx,int cy,int r,Color=COLOR_ON){
    for(int j=-r;j<=r;j++) for(int i=-r;i<=r;i++) if(i*i+j*j<=r*r) setz(cx+i,cy+j,'o');
  }
  void filled_ring(int cx,int cy,int r1,int r2,Color=COLOR_ON){
    int ra=std::max(r1,r2), ri=std::min(r1,r2);
    for(int j=-ra;j<=ra;j++) for(int i=-ra;i<=ra;i++){int d=i*i+j*j; if(d<=ra*ra&&d>=ri*ri) setz(cx+i,cy+j,'O');}
  }
  void triangle(int x1,int y1,int x2,int y2,int x3,int y3,Color=COLOR_ON){
    line(x1,y1,x2,y2); line(x2,y2,x3,y3); line(x3,y3,x1,y1);
  }
  void filled_triangle(int x1,int y1,int x2,int y2,int x3,int y3,Color=COLOR_ON){
    int minx=std::min({x1,x2,x3}), maxx=std::max({x1,x2,x3});
    int miny=std::min({y1,y2,y3}), maxy=std::max({y1,y2,y3});
    auto kante=[](int ax,int ay,int bx,int by,int px,int py){
      return (bx-ax)*(py-ay)-(by-ay)*(px-ax); };
    for(int y=miny;y<=maxy;y++) for(int x=minx;x<=maxx;x++){
      long a=kante(x1,y1,x2,y2,x,y), b=kante(x2,y2,x3,y3,x,y), c=kante(x3,y3,x1,y1,x,y);
      if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0)) setz(x,y,'#');
    }
  }
  void print(int x,int y,BaseFont*,Color,TextAlign a,const char*t){ schreib(x,y,a,t); }
  void printf(int x,int y,BaseFont*,Color,TextAlign a,const char*fmt,...){
    char buf[256]; va_list ap; va_start(ap,fmt); vsnprintf(buf,sizeof buf,fmt,ap); va_end(ap);
    schreib(x,y,a,buf);
  }
  // Text grob: rund 7 Bildpunkte je Zeichen, damit die BREITE sichtbar wird.
  void schreib(int x,int y,TextAlign a,const char*t){
    int n=0; for(const char*p=t;*p;p++) if((*p&0xC0)!=0x80) n++;
    int bx = a==TextAlign::CENTER ? x-n*7/2 : a==TextAlign::CENTER_RIGHT ? x-n*7 : x;
    int i=0; for(const char*p=t;*p;p++){ if((*p&0xC0)==0x80) continue;
      for(int k=0;k<7;k++) setz(bx+i*7+k, y, k<6 ? *p : ' '); i++; }
  }
};
} // namespace esphome
using namespace esphome;

static BaseFont f_xl{46}, f_l{34}, f_m{19}, f_s{14};
static Color k_h{0,0,0}, k_t{255,255,255}, k_g{128,128,128}, k_p{0,0,255},
             k_w{255,0,0}, k_gut{0,255,0}, k_s{255,255,255};
static sensor::Sensor s_tempo, s_limit, s_limit_fz, s_mdist, s_rest, s_lr, s_vh;
static binary_sensor::BinarySensor s_schnell;
static text_sensor::TextSensor s_anweisung, s_art, s_zustand, s_ankunft;
static switch_::Switch s_erzwingen, s_fahrzeug, s_restzeit;
static RealTimeClock s_uhr;
static BaseFont *font_xl=&f_xl,*font_l=&f_l,*font_m=&f_m,*font_s=&f_s;
static Color &c_hintergrund=k_h,&c_text=k_t,&c_gedaempft=k_g,&c_pfeil=k_p,
             &c_warnung=k_w,&c_gut=k_gut,&c_schild=k_s;
static sensor::Sensor *yapaja_tempo=&s_tempo,*yapaja_tempolimit=&s_limit,
  *yapaja_tempolimit_fahrzeug=&s_limit_fz,*yapaja_manoever_entfernung=&s_mdist,
  *yapaja_reststrecke=&s_rest,*neigung_lr=&s_lr,*neigung_vh=&s_vh;
static switch_::Switch *waage_erzwingen=&s_erzwingen,*waage_fahrzeug=&s_fahrzeug,
  *eta_als_restzeit=&s_restzeit;
static RealTimeClock *ha_zeit=&s_uhr;
static binary_sensor::BinarySensor *yapaja_zu_schnell=&s_schnell;
static text_sensor::TextSensor *yapaja_anweisung=&s_anweisung,*yapaja_manoever_art=&s_art,
  *yapaja_fahrzustand=&s_zustand,*yapaja_ankunft=&s_ankunft;

static void zeichne(Display &it) {
#include "lambda_body.inc"
}

/** Die Fahransicht -- zum Ansehen der neuen Aufteilung. */
static void fahrt(const char *titel, float tempo, bool zu_schnell,
                  bool restzeit = false, const char *jetzt = "2026-09-15T12:57:00",
                  const char *art = "turn_left") {
  s_zustand.state="navigating"; s_art.state=art;
  s_anweisung.state="Abbiegen";
  s_ankunft.state="2026-09-15T14:32:00.000Z";
  s_tempo.has=true; s_tempo.state=tempo;
  s_limit.has=true; s_limit.state=50;
  s_limit_fz.has=true; s_limit_fz.state=80;
  s_mdist.has=true; s_mdist.state=37;
  s_rest.has=true; s_rest.state=299.3f;
  s_lr.has=false; s_lr.state=NAN; s_vh.has=false; s_vh.state=NAN;
  s_schnell.state=zu_schnell; s_erzwingen.state=false; s_fahrzeug.state=false;
  s_restzeit.state=restzeit;
  {
    int Y,Mo,D,h,mi,se;
    s_uhr.jetzt = ESPTime{};
    if (sscanf(jetzt, "%4d-%2d-%2dT%2d:%2d:%2d", &Y,&Mo,&D,&h,&mi,&se) == 6) {
      s_uhr.jetzt.year=Y; s_uhr.jetzt.month=Mo; s_uhr.jetzt.day_of_month=D;
      s_uhr.jetzt.hour=h; s_uhr.jetzt.minute=mi; s_uhr.jetzt.second=se;
      s_uhr.jetzt.recalc_timestamp_utc(false);
    }
  }

  Display it(240,240); zeichne(it);
  printf("\n=== %s ===\n", titel);
  for (int y=0; y<240; y+=4) {
    std::string z;
    for (int x=0; x<240; x+=2) z += it.feld[y*240+x];
    while (!z.empty() && z.back()==' ') z.pop_back();
    printf("%s\n", z.c_str());
  }
}

static void zeige(const char *titel, float lr, float vh, bool fahrzeug) {
  s_zustand.state="idle"; s_art.state="turn_left";
  s_anweisung.state="x"; s_ankunft.state="2026-09-15T14:32:00.000Z";
  s_tempo.has=true; s_tempo.state=0;
  s_limit.has=false; s_limit.state=NAN;
  s_limit_fz.has=false; s_limit_fz.state=NAN;
  s_mdist.has=false; s_mdist.state=NAN;
  s_rest.has=false; s_rest.state=NAN;
  s_lr.has=true; s_lr.state=lr; s_vh.has=true; s_vh.state=vh;
  s_schnell.state=false; s_erzwingen.state=false; s_fahrzeug.state=fahrzeug;

  Display it(240,240); zeichne(it);
  printf("\n=== %s ===\n", titel);
  // Jede zweite Zeile, jede zweite Spalte -- Zeichen sind hoeher als breit.
  for (int y=0; y<240; y+=4) {
    std::string z;
    for (int x=0; x<240; x+=2) z += it.feld[y*240+x];
    while (!z.empty() && z.back()==' ') z.pop_back();
    printf("%s\n", z.c_str());
  }
}

int main() {
  setenv("TZ","Europe/Berlin",1); tzset();
  fahrt("Fahrt: 48 km/h, im Limit", 48, false);
  fahrt("Fahrt: 63 km/h, ZU SCHNELL (roter Ring)", 63, true);
  // ─── DIE BEIDEN ETA-MODI NEBENEINANDER ──────────────────────────────────
  // Die eigentliche Frage an dieses Bild: passt „1:35 h" noch neben ein
  // dreistelliges Tempo? Gemessen wird das nirgends -- die Zeichenpruefung
  // merkt sich Texte, keine Textbreiten.
  fahrt("Fahrt: 130 km/h, Ankunftszeit (16:32)", 130, false, false);
  fahrt("Fahrt: 130 km/h, Restzeit (1:35 h)", 130, false, true);
  fahrt("PFEIL turn_left", 50, false, false, "2026-09-15T12:57:00", "turn_left");
  fahrt("PFEIL turn_right", 50, false, false, "2026-09-15T12:57:00", "turn_right");
  zeige("Fahrzeug: vorne tief (-1.5 Grad), rechts hoch (+1.0 Grad)", 1.0f, -1.5f, true);
  zeige("Fahrzeug: eben", 0.1f, -0.1f, true);
  return 0;
}
