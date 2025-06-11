document.addEventListener('DOMContentLoaded', function () {
    const liveDashboard = document.getElementById('live-dashboard');
    const gpxInfoEl = document.getElementById('gpx-info');
    const gpxFileInput = document.getElementById('gpx-file');
    const controls = document.getElementById('controls');
    const infoTextEl = document.getElementById('info-text');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const saveBtn = document.getElementById('btn-save');
    const distanceValueEl = document.getElementById('distance-value');
    const avgSpeedValueEl = document.getElementById('avg-speed-value');
    const maxSpeedValueEl = document.getElementById('max-speed-value');
    const gaugeProgressEl = document.querySelector('.gauge-progress');
    const gaugeValueEl = document.querySelector('.gauge-value');

    const gaugeRadius = 54, gaugeCircumference = 2 * Math.PI * gaugeRadius, MAX_SPEED_ON_GAUGE = 150;
    gaugeProgressEl.style.strokeDasharray = gaugeCircumference;
    let isTracking = false, watchId = null, trackedPoints = [], userMarker;
    let totalDistance = 0, maxSpeed = 0, startTime = null, lastPosition = null;
    const TAIL_LENGTH = 70;
    let tailSegments = [], tailColors = [], currentTailIndex = 0;

    const map = L.map('map').setView([16.047079, 108.206230], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 20
    }).addTo(map);

    function generateGradientColors(start, end, steps) {
        const sR = parseInt(start.slice(1,3),16), sG = parseInt(start.slice(3,5),16), sB = parseInt(start.slice(5,7),16);
        const eR = parseInt(end.slice(1,3),16), eG = parseInt(end.slice(3,5),16), eB = parseInt(end.slice(5,7),16);
        const colors = [];
        for (let i = 0; i < steps; i++) {
            const ratio = i / (steps - 1);
            const r = Math.round(sR + ratio * (eR - sR)), g = Math.round(sG + ratio * (eG - sG)), b = Math.round(sB + ratio * (eB - sB));
            colors.push(`#${(1<<24 | r<<16 | g<<8 | b).toString(16).slice(1)}`);
        } return colors;
    }
    
    function updateSpeedGauge(speed) {
        const speedKmh = Math.round(speed);
        gaugeValueEl.textContent = speedKmh;
        const percentage = Math.min(speedKmh / MAX_SPEED_ON_GAUGE, 1);
        const offset = gaugeCircumference * (1 - percentage);
        gaugeProgressEl.style.strokeDashoffset = offset;
    }

    function resetStats() {
        totalDistance = 0, maxSpeed = 0, startTime = null, lastPosition = null;
        trackedPoints = []; distanceValueEl.textContent = '0.00 km';
        avgSpeedValueEl.textContent = '0 km/h'; maxSpeedValueEl.textContent = '0 km/h';
        updateSpeedGauge(0);
        tailSegments.forEach(segment => map.removeLayer(segment));
        tailSegments = [], currentTailIndex = 0;
    }

    function startTracking() {
        if (!('geolocation' in navigator)) { infoTextEl.textContent = "Trình duyệt không hỗ trợ GPS"; return; }
        liveDashboard.classList.remove('hidden');
        gpxInfoEl.classList.add('hidden');
        isTracking = true;
        resetStats();
        infoTextEl.textContent = 'Đang tìm tín hiệu GPS...';
        const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
        watchId = navigator.geolocation.watchPosition(onSuccess, onError, options);
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        saveBtn.classList.add('hidden');
        saveBtn.disabled = true;
    }

    function stopTracking() {
        isTracking = false;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = null; lastPosition = null; updateSpeedGauge(0);
        infoTextEl.textContent = 'Đã dừng. Nhấn "Lưu" hoặc "Start".';
        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        if (trackedPoints.length > 1) {
            saveBtn.classList.remove('hidden');
            saveBtn.disabled = false;
        }
    }

    function onSuccess(position) {
        if (!isTracking) return;
        const { latitude, longitude, speed, altitude, accuracy } = position.coords;
        const currentCoords = [latitude, longitude];
        const speedKmh = speed ? speed * 3.6 : 0;
        updateSpeedGauge(speedKmh);
        maxSpeed = Math.max(maxSpeed, speedKmh);
        maxSpeedValueEl.textContent = `${Math.round(maxSpeed)} km/h`;
        if (lastPosition) {
            const distanceIncrement = map.distance([lastPosition.coords.latitude, lastPosition.coords.longitude], currentCoords);
            totalDistance += distanceIncrement;
            distanceValueEl.textContent = `${(totalDistance / 1000).toFixed(2)} km`;
            const elapsedTime = (position.timestamp - startTime) / 1000;
            if (elapsedTime > 0) {
                const avgSpeedKmh = (totalDistance / elapsedTime) * 3.6;
                avgSpeedValueEl.textContent = `${Math.round(avgSpeedKmh)} km/h`;
            }
            const segment = tailSegments[currentTailIndex];
            const newSegmentCoords = [[lastPosition.coords.latitude, lastPosition.coords.longitude], currentCoords];
            if (segment) { segment.setLatLngs(newSegmentCoords); } 
            else { tailSegments[currentTailIndex] = L.polyline(newSegmentCoords, { weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(map); }
            for (let i = 0; i < TAIL_LENGTH; i++) {
                const index = (currentTailIndex - i + TAIL_LENGTH) % TAIL_LENGTH;
                if (tailSegments[index]) { tailSegments[index].setStyle({ color: tailColors[i] || tailColors[TAIL_LENGTH - 1] }); }
            }
            currentTailIndex = (currentTailIndex + 1) % TAIL_LENGTH;
        } else { startTime = position.timestamp; }
        trackedPoints.push({ lat: latitude, lon: longitude, ele: altitude || 0, time: new Date(position.timestamp).toISOString() });
        lastPosition = position;
        infoTextEl.textContent = `Độ chính xác: ${Math.round(accuracy)}m`;
        if (!userMarker) {
            const liveIcon = L.divIcon({ className: 'location-dot', html: '<div class="location-ping"></div><div class="location-center"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
            userMarker = L.marker(currentCoords, { icon: liveIcon }).addTo(map);
            map.setView(currentCoords, 17);
        } else { userMarker.setLatLng(currentCoords); }
        map.panTo(currentCoords, { animate: true });
    }

    function onError(error) { infoTextEl.textContent = `Lỗi GPS: ${error.message}`; if (isTracking) stopTracking(); }

    function saveTrackAsGPX() {
        if (trackedPoints.length < 2) { alert('Không có đủ dữ liệu lộ trình để lưu.'); return; }
        let gpxContent = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="GPS Speedometer Web App" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"><metadata><time>${new Date().toISOString()}</time></metadata><trk><name>Lộ trình được ghi lại</name><trkseg>`;
        trackedPoints.forEach(point => { gpxContent += `<trkpt lat="${point.lat}" lon="${point.lon}"><ele>${point.ele}</ele><time>${point.time}</time></trkpt>`; });
        gpxContent += `</trkseg></trk></gpx>`;
        const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date();
        const fileName = `track_${timestamp.getFullYear()}-${String(timestamp.getMonth()+1).padStart(2,'0')}-${String(timestamp.getDate()).padStart(2,'0')}.gpx`;
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function handleGPXUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        liveDashboard.classList.add('hidden');
        controls.classList.add('hidden');
        gpxInfoEl.classList.remove('hidden');
        gpxInfoEl.innerHTML = `<p>Đang đọc file: ${file.name}...</p>`;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const gpx = new DOMParser().parseFromString(e.target.result, "text/xml");
                map.eachLayer(layer => { if (layer instanceof L.Polyline || layer instanceof L.Marker) { map.removeLayer(layer); } });
                const trackpoints = gpx.querySelectorAll('trkpt');
                if (trackpoints.length === 0) { throw new Error("File GPX không chứa điểm tọa độ nào."); }
                const latlngs = Array.from(trackpoints).map(pt => [parseFloat(pt.getAttribute('lat')), parseFloat(pt.getAttribute('lon'))]);
                const polyline = L.polyline(latlngs, { color: 'var(--accent-color)', weight: 4 }).addTo(map);
                map.fitBounds(polyline.getBounds());
                let totalDistance = 0;
                for (let i = 0; i < latlngs.length - 1; i++) { totalDistance += map.distance(latlngs[i], latlngs[i+1]); }
                gpxInfoEl.innerHTML = `<h2>Thông tin Lộ trình GPX</h2><p>Tên file: <span>${file.name}</span></p><p>Số điểm: <span>${trackpoints.length}</span></p><p>Tổng quãng đường: <span>${(totalDistance / 1000).toFixed(2)} km</span></p>`;
            } catch (err) { gpxInfoEl.innerHTML = `<p style="color:var(--stop-color);">Lỗi khi đọc file: ${err.message}</p>`; }
        };
        reader.onerror = function() { gpxInfoEl.innerHTML = `<p style="color:var(--stop-color);">Không thể đọc file.</p>`; };
        reader.readAsText(file);
    }

    startBtn.addEventListener('click', startTracking);
    stopBtn.addEventListener('click', stopTracking);
    saveBtn.addEventListener('click', saveTrackAsGPX);
    gpxFileInput.addEventListener('change', handleGPXUpload);

    tailColors = generateGradientColors('#00aaff', '#1a2332', TAIL_LENGTH);
    updateSpeedGauge(0);
});
