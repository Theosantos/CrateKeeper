import electronLogo from './assets/electron.svg'

function App(): React.JSX.Element {
  return (
    <>
      <img alt="logo" className="logo" src={electronLogo} />
      <div className="creator">DJ Utils — backbone scaffold</div>
      <div className="text">
        Phase 1 / Plan 01-01 — the real UI lands in Plan 01-02. Open DevTools and try{' '}
        <code>window.djUtils.getRootFolder()</code>.
      </div>
    </>
  )
}

export default App
