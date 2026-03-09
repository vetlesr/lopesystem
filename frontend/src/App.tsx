import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RaceList from './pages/RaceList'
import BackyardDashboard from './pages/BackyardDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RaceList />} />
        <Route path="/races/:raceId" element={<BackyardDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
