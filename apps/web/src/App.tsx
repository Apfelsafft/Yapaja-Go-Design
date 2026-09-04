import React from 'react';
import MapView from './map/MapView';
import PositionInitializer from './position/PositionInitializer';
import RoutingInitializer from './routing/RoutingInitializer.js';
import FavoritesDrawer from './favorites/FavoritesDrawer.js';
import DriveOverlay from './drive/DriveOverlay.js';
import SpeedDisplay from './drive/SpeedDisplay.js';
import ThemeController from './theme/ThemeController.js';
import DriveLockController from './drive/DriveLockController.js';
import HandednessController from './shell/HandednessController.js';
import TopBar from './shell/TopBar.js';
import UpdatePrompt from './pwa/UpdatePrompt.js';
import OnboardingWizard from './onboarding/OnboardingWizard.js';
import AddonHost from './addons/AddonHost.js';

export default function App(): React.ReactElement {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white dark:bg-slate-900">
      <ThemeController />
      <DriveLockController />
      <HandednessController />
      <MapView />
      <PositionInitializer />
      {/* Marke, Fahrzeugprofil und Suche liegen in EINER Flex-Zeile
          (shell/TopBar.tsx). Vorher positionierte sich jedes der drei selbst
          -- und ueberlagerte die anderen, je nach Fensterbreite. */}
      <TopBar />
      <RoutingInitializer />
      <FavoritesDrawer />
      <DriveOverlay />
      {/* Tacho: haengt an der Position, also auch ohne laufende Navigation da. */}
      <SpeedDisplay />
      <UpdatePrompt />
      <OnboardingWizard />
      {/* E09-T2: sandboxed UI add-on runtime (iframes + scope-checked bridge,
          add-on widgets, route-proposal banner). Renders nothing until an
          enabled UI add-on is installed. */}
      <AddonHost />
    </div>
  );
}
