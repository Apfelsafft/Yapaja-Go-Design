import React from 'react';
import MapView from './map/MapView';
import PositionInitializer from './position/PositionInitializer';
import RoutingInitializer from './routing/RoutingInitializer.js';
import DriveOverlay from './drive/DriveOverlay.js';
import AnordnungsLeiste from './shell/AnordnungsLeiste.js';
import AnkerGriff from './shell/AnkerGriff.js';
import SprachFenster from './sprache/SprachFenster.js';
import SpeedDisplay from './drive/SpeedDisplay.js';
import ThemeController from './theme/ThemeController.js';
import DriveLockController from './drive/DriveLockController.js';
import HandednessController from './shell/HandednessController.js';
import ScreenAwakeController from './shell/ScreenAwakeController.js';
import TopBar from './shell/TopBar.js';
import FavoritenLader from './favorites/FavoritenLader.js';
import UpdatePrompt from './pwa/UpdatePrompt.js';
import OnboardingWizard from './onboarding/OnboardingWizard.js';
import UnconfirmedDimensionsBanner from './profiles/UnconfirmedDimensionsBanner.js';
import AddonHost from './addons/AddonHost.js';
import BordHinweis from './bord/BordHinweis.js';
import AnsageKanal from './drive/AnsageKanal.js';

export default function App(): React.ReactElement {
  return (
    // `#yapaia-sicht` (index.css) ist nur so groß wie der SICHTBARE Teil des
    // Fensters, und alle `fixed`-Elemente darin richten sich nach ihm statt
    // nach dem ganzen Rahmen -- siehe shell/sichtbarerBereich.ts.
    <div id="yapaia-sicht" className="overflow-hidden bg-white dark:bg-slate-900">
      <ThemeController />
      <DriveLockController />
      <HandednessController />
      {/* Der Bildschirm bleibt an, solange Yapaia zu sehen ist -- „quasi
          analog zu Maps". Ueber einfaches HTTP gibt es `navigator.wakeLock`
          nicht; dann uebernimmt das stumme Video (shell/screenAwake.ts). */}
      <ScreenAwakeController />
      <MapView />
      <PositionInitializer />
      {/* Marke, Fahrzeugprofil und Suche liegen in EINER Flex-Zeile
          (shell/TopBar.tsx). Vorher positionierte sich jedes der drei selbst
          -- und ueberlagerte die anderen, je nach Fensterbreite. */}
      <TopBar />
      {/* Favoriten und Verlauf laden, auch wenn gerade nichts sie zeigt. */}
      <FavoritenLader />
      <RoutingInitializer />
      <DriveOverlay />
      {/* Bearbeitungsmodus „Bildschirm anpassen" (shell/anordnung.ts). */}
      <AnordnungsLeiste />
      <AnkerGriff />
      {/* Sprachbefehle (0.29): 🎤 in Kopfzeile und Fahrt. */}
      <SprachFenster />
      {/* Bordsensoren: Grau-/Frischwasser, Batterie, Frost -- mit der
          passenden Station voraus (bord/BordHinweis.tsx). */}
      <BordHinweis />
      {/* Ansagen des Kerns an den Browser, in dem das Radio spielt (drive/AnsageKanal.tsx). */}
      <AnsageKanal />
      {/* Tacho: haengt an der Position, also auch ohne laufende Navigation da. */}
      <SpeedDisplay />
      <UpdatePrompt />
      {/* Sicherheitshinweis, solange die Fahrzeugmasse nie bestaetigt wurden.
          Er blendet sich selbst aus, solange der Assistent laeuft (beide sind
          `z-50`-Overlays) -- siehe UnconfirmedDimensionsBanner.tsx. */}
      <OnboardingWizard />
      <UnconfirmedDimensionsBanner />
      {/* E09-T2: sandboxed UI add-on runtime (iframes + scope-checked bridge,
          add-on widgets, route-proposal banner). Renders nothing until an
          enabled UI add-on is installed. */}
      <AddonHost />
    </div>
  );
}
