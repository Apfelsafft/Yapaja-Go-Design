import React from 'react';
import MapView from './map/MapView';
import PositionInitializer from './position/PositionInitializer';
import ProfilesPanel from './profiles/ProfilesPanel.js';
import RoutingInitializer from './routing/RoutingInitializer.js';
import SearchBar from './search/SearchBar.js';
import FavoritesDrawer from './favorites/FavoritesDrawer.js';
import DriveOverlay from './drive/DriveOverlay.js';
import ThemeController from './theme/ThemeController.js';
import DriveLockController from './drive/DriveLockController.js';
import HandednessController from './shell/HandednessController.js';

export default function App(): React.ReactElement {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white dark:bg-slate-900">
      <ThemeController />
      <DriveLockController />
      <HandednessController />
      <MapView />
      <PositionInitializer />
      <header className="absolute top-0 left-0 p-3 pointer-events-none">
        <h1 className="inline-block pointer-events-auto bg-white/90 dark:bg-slate-900/90 rounded px-3 py-1 text-lg font-bold text-slate-900 dark:text-white shadow-md">
          Yapaja Go
        </h1>
      </header>
      <ProfilesPanel />
      <RoutingInitializer />
      <SearchBar />
      <FavoritesDrawer />
      <DriveOverlay />
    </div>
  );
}
