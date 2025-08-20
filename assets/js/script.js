/* CONFIG */
const WEATHER_API_KEY = "996ff66f8d314d04a62224030250908"; // provided by user
const DEFAULT_CITY = { name: "Bengaluru", state: "", country: "IN", lat: 12.9716, lon: 77.5946 };

/* DOM */
const cityInput = document.getElementById("cityInput");
const suggestions = document.getElementById("suggestions");
const inputWrap = document.querySelector(".input-wrap");
const useLocationBtn = document.getElementById("useLocationBtn");
const placeName = document.getElementById("placeName");
const updatedAt = document.getElementById("updatedAt");
const tempNow = document.getElementById("tempNow");
const currentIcon = document.getElementById("currentIcon");
const feelsLike = document.getElementById("feelsLike");
const humidity = document.getElementById("humidity");
const wind = document.getElementById("wind");
const pressure = document.getElementById("pressure");
const uvi = document.getElementById("uvi");
const visibility = document.getElementById("visibility");
const weatherDesc = document.getElementById("weatherDesc");
const forecastGrid = document.getElementById("forecastGrid");
const toggleUnitsBtn = document.getElementById("toggleUnits");
const modeSwitch = document.getElementById("modeSwitch");
const sunriseEl = document.getElementById("sunrise");
const sunsetEl = document.getElementById("sunset");
const moonriseEl = document.getElementById("moonrise");
const moonsetEl = document.getElementById("moonset");
const moonPhaseEl = document.getElementById("moonPhase");


/* STATE */
let units = (localStorage.getItem("units") || "metric"); // 'metric' | 'imperial'
let theme = (localStorage.getItem("theme") || "light"); // 'light' | 'dark'
document.documentElement.setAttribute("data-theme", theme);
modeSwitch.checked = theme === "dark";

let abortSuggest;
const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/* Helpers */
const fmtTemp = (t) => {
  if (!t) return "—";
  return `${Math.round(units === "metric" ? t.c : t.f)}°`;
};
const fmtWind = (w) => {
  if (!w) return "—";
  return units === "metric" ? `${Math.round(w.kph)} km/h` : `${Math.round(w.mph)} mph`;
};
const fmtVisibility = (v) => {
  if (!v) return "—";
  return units === "metric" ? `${v.km.toFixed(1)} km` : `${v.mi.toFixed(1)} mi`;
};
const fmtPressure = (p) => (p != null ? `${p} hPa` : "—");
const tsToLocal = (ts, tzOffsetSec) => new Date((ts + tzOffsetSec) * 1000);
const weekdayShort = (date) => date.toLocaleDateString(undefined, { weekday: "short" });
const monthDay = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* Geocoding via Nominatim */
async function geocodeSearch(query, limit = 8) {
  const key = `geocode:${query.toLowerCase()}`;
  const cached = getCached(key);
  if (cached) return cached;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": "WeatherApp/1.0" } });
  if (!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  const places = data.map(p => ({
    name: p.display_name.split(",")[0],
    state: p.address?.state || "",
    country: p.address?.country_code?.toUpperCase() || "",
    lat: parseFloat(p.lat),
    lon: parseFloat(p.lon)
  }));

  setCached(key, places, 7 * 24 * 60 * 60 * 1000); // 7 days
  return places;
}

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": "WeatherApp/1.0" } });
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const place = await res.json();
  return {
    name: place.address?.city || place.address?.town || place.address?.village || "Unknown",
    state: place.address?.state || "",
    country: place.address?.country_code?.toUpperCase() || "",
    lat, lon
  };
}

/* Weather via WeatherAPI */
async function fetchWeather(lat, lon) {
  const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = getCached(key);
  if (cached) return cached;

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&days=7&aqi=no&alerts=no`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  const data = await res.json();

  const todayAstro = data.forecast.forecastday[0].astro;

  const weatherData = {
    _source: "weatherapi",
    lat, lon,
    location: {
      tz_id: data.location.tz_id,
      name: data.location.name,
      country: data.location.country
    },
    current: {
      dt: data.current.last_updated_epoch,
      temp: { c: data.current.temp_c, f: data.current.temp_f },
      feels_like: { c: data.current.feelslike_c, f: data.current.feelslike_f },
      humidity: data.current.humidity,
      pressure: data.current.pressure_mb,
      visibility: { km: data.current.vis_km, mi: data.current.vis_miles },
      wind: { kph: data.current.wind_kph, mph: data.current.wind_mph },
      uvi: data.current.uv,
      weather: [{ description: data.current.condition.text, icon: mapIcon(data.current.condition.icon) }]
    },
    daily: data.forecast.forecastday.map(d => ({
      dt: Math.floor(new Date(d.date).getTime() / 1000),
      temp: {
        min: { c: d.day.mintemp_c, f: d.day.mintemp_f },
        max: { c: d.day.maxtemp_c, f: d.day.maxtemp_f },
        day: { c: d.day.avgtemp_c, f: d.day.avgtemp_f }
      },
      humidity: d.day.avghumidity,
      pressure: d.hour[12]?.pressure_mb ?? null,
      wind: { kph: d.day.maxwind_kph, mph: d.day.maxwind_mph },
      weather: [{ description: d.day.condition.text, icon: mapIcon(d.day.condition.icon) }]
    })),
    astro: {
      sunrise: todayAstro.sunrise,
      sunset: todayAstro.sunset,
      moonrise: todayAstro.moonrise,
      moonset: todayAstro.moonset,
    }
  };

  setCached(key, weatherData, 10 * 60 * 1000);
  return weatherData;
}


/* Map WeatherAPI icons */
function mapIcon(url) {
  return url.replace(/^\/\//, "https://");
}

/* UI Rendering */
function setPlaceTitle(place) {
  const parts = [place.name, place.state, place.country].filter(Boolean);
  placeName.textContent = parts.join(", ");
}

function renderCurrent(data, place) {
  setPlaceTitle(place);
  const tz = data.timezone_offset || 0;
  updatedAt.textContent = `Updated ${monthDay(tsToLocal(data.current.dt, tz))} ${tsToLocal(data.current.dt, tz).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  tempNow.textContent = fmtTemp(data.current.temp);

  const icon = data.current.weather?.[0]?.icon || "";
  const desc = data.current.weather?.[0]?.description || "";
  currentIcon.src = icon || "https://cdn.weatherapi.com/weather/64x64/day/113.png";
  currentIcon.alt = desc;

  feelsLike.textContent = fmtTemp(data.current.feels_like);
  humidity.textContent = `${data.current.humidity ?? "—"}%`;
  wind.textContent = fmtWind(data.current.wind_speed ?? 0);
  pressure.textContent = fmtPressure(data.current.pressure);
  uvi.textContent = data.current.uvi != null ? `${Math.round(data.current.uvi)}` : "—";
  visibility.textContent = fmtVisibility(data.current.visibility);
  weatherDesc.textContent = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "—";

  // Astronomy info
  if (data.astro) {
    sunriseEl.textContent = data.astro.sunrise || "—";
    sunsetEl.textContent = data.astro.sunset || "—";
    moonriseEl.textContent = data.astro.moonrise || "—";
    moonsetEl.textContent = data.astro.moonset || "—";
  }
}

function renderForecast(data) {
  const tz = data.timezone_offset || 0;
  forecastGrid.innerHTML = "";
  const days = (data.daily || []).slice(1, 7);
  for (const d of days) {
    const date = tsToLocal(d.dt, tz);
    const icon = d.weather?.[0]?.icon || "https://cdn.weatherapi.com/weather/64x64/day/113.png";
    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `
      <div class="d">${weekdayShort(date)}</div>
      <div class="date subtle">${monthDay(date)}</div>
      <img src="${icon}" alt="${d.weather?.[0]?.description || ""}" />
      <div class="hi">${fmtTemp(d.temp?.max)}</div>
      <div class="lo">${fmtTemp(d.temp?.min)}</div>
    `;
    forecastGrid.appendChild(el);
  }
}

/* Data flow */
async function loadByCoords(lat, lon, placeInfo) {
  const cacheKey = `weather:${lat.toFixed(2)},${lon.toFixed(2)},${units}`;
  const cached = getCached(cacheKey);

  // If cached data exists → render immediately
  if (cached) {
    const place = placeInfo ? placeInfo : JSON.parse(localStorage.getItem("lastPlace") || "null");
    renderCurrent(cached, place || { lat, lon });
    renderForecast(cached);
  }

  // Always attempt fresh fetch in background
  try {
    const [data, place] = await Promise.all([
      fetchWeather(lat, lon), // fetches & updates cache
      placeInfo ? Promise.resolve(placeInfo) : reverseGeocode(lat, lon)
    ]);

    renderCurrent(data, place);
    renderForecast(data);
    localStorage.setItem("lastPlace", JSON.stringify(place));
  } catch (err) {
    console.error(err);
    if (!cached) showToast("Sorry, couldn't fetch weather right now.");
  }
}


const doSuggest = debounce(async (q) => {
  if (!q || q.trim().length < 2) {
    suggestions.classList.remove("show");
    suggestions.innerHTML = "";
    return;
  }
  try {
    if (abortSuggest) abortSuggest.abort();
    abortSuggest = new AbortController();
    const places = await geocodeSearch(q, 8);
    suggestions.innerHTML = "";
    places.forEach((p) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.tabIndex = 0;
      li.textContent = [p.name, p.state, p.country].filter(Boolean).join(", ");
      li.addEventListener("click", () => {
        cityInput.value = li.textContent;
        suggestions.classList.remove("show");
        loadByCoords(p.lat, p.lon, p);
      });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter") li.click();
      });
      suggestions.appendChild(li);
    });
    suggestions.classList.toggle("show", places.length > 0);
  } catch {}
}, 250);

/* Events */
cityInput.addEventListener("input", (e) => doSuggest(e.target.value));
document.addEventListener("click", (e) => {
  if (!inputWrap.contains(e.target)) {
    suggestions.classList.remove("show");
  }
});

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      console.log("Latitude:", latitude, "Longitude:", longitude);
      loadByCoords(latitude, longitude);
    },
    (err) => {
      console.error("Error Code =", err.code, "-", err.message);
      showToast("Couldn't get your location. Please allow permission or search manually.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

toggleUnitsBtn.addEventListener("click", () => {
  units = units === "metric" ? "imperial" : "metric";
  localStorage.setItem("units", units);
  toggleUnitsBtn.textContent = units === "metric" ? "Switch to °F" : "Switch to °C";
  const last = JSON.parse(localStorage.getItem("lastPlace") || "null") || DEFAULT_CITY;
  loadByCoords(last.lat, last.lon, last);
});

modeSwitch.addEventListener("change", () => {
  theme = modeSwitch.checked ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
});

/* Init */
(async function init() {
  document.documentElement.setAttribute("data-theme", theme);
  modeSwitch.checked = theme === "dark";
  toggleUnitsBtn.textContent = units === "metric" ? "Switch to °F" : "Switch to °C";
  const last = JSON.parse(localStorage.getItem("lastPlace") || "null");
  if (last?.lat && last?.lon) {
    setPlaceTitle(last);
    loadByCoords(last.lat, last.lon, last);
  } else {
   // Try IP-based city detection first
   const ipCity = await getCityByIP();
   if (ipCity) {
     setPlaceTitle(ipCity);
     loadByCoords(ipCity.lat, ipCity.lon, ipCity);
     localStorage.setItem("lastPlace", JSON.stringify(ipCity));
     showToast(`Using detected location: ${ipCity.name}, ${ipCity.state}, ${ipCity.country}`);
   } else {
      // fallback to default city
      setPlaceTitle(DEFAULT_CITY);
      loadByCoords(DEFAULT_CITY.lat, DEFAULT_CITY.lon, DEFAULT_CITY);
    }
  }
})();

async function getCityByIP() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) throw new Error("IP fetch failed");
    const data = await res.json();
    if (data.city && data.latitude && data.longitude) {
      return {
        name: data.city,
        state: data.region || "",
        country: data.country || "",
        lat: data.latitude,
        lon: data.longitude
      };
    }
  } catch (err) {
    console.warn("IP location failed:", err);
  }
  return null; // fallback
}

/* DOM: Settings & Greeting */
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const saveSettings = document.getElementById("saveSettings");
const cancelSettings = document.getElementById("cancelSettings");
const userNameInput = document.getElementById("userName");
const greetingEl = document.getElementById("greeting");

function getGreeting(name) {
  const hour = new Date().getHours();
  let greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${greet}, ${name}!` : `${greet}!`;
}
function showGreeting() {
  const storedName = localStorage.getItem("userName") || "";
  greetingEl.textContent = getGreeting(storedName);
}
settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  userNameInput.value = localStorage.getItem("userName") || "";
  modeSwitch.checked = theme === "dark";
});
function closeModal() {
  settingsModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}
closeSettings.addEventListener("click", closeModal);
cancelSettings.addEventListener("click", closeModal);
saveSettings.addEventListener("click", () => {
  const name = userNameInput.value.trim();
  localStorage.setItem("userName", name);
  showGreeting();
  closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) closeModal();
  if (e.key === "Escape" && suggestions.classList.contains("show")) {
      suggestions.classList.remove("show");
      cityInput.blur();
    }
});
showGreeting();
function showToast(message, duration = 4000) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  container.appendChild(toast);

  // Force reflow so transition applies
  requestAnimationFrame(() => toast.classList.add("show"));

  // Auto remove after duration
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

cityInput.setAttribute('role','combobox');
cityInput.setAttribute('aria-autocomplete','list');
cityInput.setAttribute('aria-controls','suggestions');
cityInput.setAttribute('aria-expanded','false');

let focusedIndex = -1;

cityInput.addEventListener('keydown', (e) => {
  const items = Array.from(suggestions.querySelectorAll('li'));
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    focusedIndex = (focusedIndex + 1) % items.length;
    items[focusedIndex].focus();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    focusedIndex = (focusedIndex - 1 + items.length) % items.length;
    items[focusedIndex].focus();
    e.preventDefault();
  }
});

// Simple cache helper (works with localStorage)
function getCached(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const { value, expiry } = JSON.parse(raw);
    if (expiry && Date.now() > expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function setCached(key, value, ttlMs) {
  const expiry = ttlMs ? Date.now() + ttlMs : null;
  localStorage.setItem(key, JSON.stringify({ value, expiry }));
}