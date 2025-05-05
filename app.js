const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = 8000;

// Middleware to parse JSON and URL-encoded data
app.use(express.static('public'));
app.use(express.json()); // Ensure JSON parsing middleware is here
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Route to handle GET request
app.get('/', (req, res) => {
  res.render('index', {
    weather: null,
    forecast: null,
    hourlyForecast: null,
    airPollution: null,
    error: null
  });
});

// Route to handle manual city search
app.post('/manual', async (req, res) => {
  const city = req.body.city.trim();
  const apiKey = process.env.WEATHER_API_KEY;

  if (!city) {
    return res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Please enter a city name.'
    });
  }

  try {
    const geocodingURL = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}`;
    const geocodeRes = await axios.get(geocodingURL);
    const { lat, lon } = geocodeRes.data.coord;

    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'City not found or API failed. Please try again.'
    });
  }
});

// Route to handle user's location (geolocation)
app.post('/location', async (req, res) => {
  const { lat, lon } = req.body; // Destructure lat and lon from the request body
  const apiKey = process.env.WEATHER_API_KEY;

  if (!lat || !lon) {
    return res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Could not fetch geolocation data.'
    });
  }

  try {
    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Could not get data for your location.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
