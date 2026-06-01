import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RaceList from './pages/RaceList'
import BackyardDashboard from './pages/BackyardDashboard'
import Scoreboard from './pages/Scoreboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RaceList />} />
        <Route path="/race/:id" element={<BackyardDashboard />} />
        <Route path="/race/:id/scoreboard" element={<Scoreboard />} />
      </Routes>
    </BrowserRouter>
  )
}
