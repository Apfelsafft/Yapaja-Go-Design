import React from 'react';

export default function App(): React.ReactElement {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <h1 className="text-3xl font-bold">Yapaja Go</h1>
        <p className="text-blue-100 text-sm mt-1">
          Browser-based offline navigation for motorhomes
        </p>
      </header>
      <main className="p-8 max-w-4xl mx-auto">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-4 text-slate-900 dark:text-white">
            Welcome
          </h2>
          <p className="text-slate-700 dark:text-slate-300 mb-4">
            Yapaja Go is starting up. This is a placeholder shell for the main application.
          </p>
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900 rounded border border-blue-200 dark:border-blue-700">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              API Status: <span className="font-mono text-green-600 dark:text-green-400">Ready</span>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
