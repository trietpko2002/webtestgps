document.addEventListener('DOMContentLoaded', function () {
    // --- BIẾN DOM (Không đổi) ---
    const infoTextEl = document.getElementById('info-text');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const saveBtn = document.getElementById('btn-save');
    const distanceValueEl = document.getElementById('distance-value');
    const avgSpeedValueEl = document.getElementById('avg-speed-value');
    const maxSpeedValueEl = document.getElementById('max-speed-value');
    const gaugeProgressEl = document.querySelector('.gauge-progress');
    const gaugeValueEl = document.querySelector('.gauge-value');
    
    // --- CÀI ĐẶT GAUGE (Không đổi) ---
    const gaugeRadius = 54;
    const gaugeCircumference = 2 * Math.PI * gaugeRadius;
    const MAX_SPEED_ON_GAUGE = 150;
    gaugeProgressEl.style.strokeDasharray = gaugeCircumference;

    // --- BIẾN TRẠNG THÁI ---
    let isTracking = false;
    let watchId = null;
    let trackedPoints = [];
    let userMarker; // Bỏ userCircle và realTimePolyline cũ
    let totalDistance = 0, maxSpeed = 0, startTime = null, lastPosition = null;

    // ================== MỚI: BIẾN CHO HIỆU ỨNG "ĐUÔI SÁNG" ==================
    const TAIL_LENGTH = 70; // Độ dài của vệt sáng (số đoạn)
    let tailSegments = []; // Mảng chứa các layer polyline của vệt sáng
    let tailColors = []; // Mảng chứa các màu gradient
    let currentTailIndex = 0; // Vị trí hiện tại trong mảng vệt sáng
    // ========================================================================

    // --- KHỞI TẠO BẢN ĐỒ (Không đổi) ---
    const map = L.map('map').setView([16.047079, 108.206230], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 20
    }).addTo(map);

    // ================== MỚI: HÀM TẠO DẢI MÀU GRADIENT ==================
    /**
     * Tạo ra một mảng các màu hex từ màu bắt đầu đến màu kết thúc.
     * @param {string} startColorHex - Màu bắt đầu, vd: '#00aaff'
     * @param {string} endColorHex - Màu kết thúc, vd: '#121212'
     * @param {number} steps - Số lượng màu cần tạo
     * @returns {string[]} Mảng các màu hex
     */
    function generateGradientColors(startColorHex, endColorHex, steps) {
        const startRGB = parseInt(startColorHex.slice(1), 16);
        const startR = (startRGB >> 16) & 255;
        const startG = (startRGB >> 8) & 255;
        const startB = startRGB & 255;

        const endRGB = parseInt(endColorHex.slice(1), 16);
        const endR = (endRGB >> 16) & 255;
        const endG = (endRGB >> 8) & 255;
        const endB = endRGB & 255;

        const colors = [];
        for (let i = 0; i < steps; i++) {
            const ratio = i / (steps - 1);
            const r = Math.round(startR + ratio * (endR - startR));
            const g = Math.round(startG + ratio * (endG - startG));
            const b = Math.round(startB + ratio * (endB - startB));
            colors.push(`#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`);
        }
        return colors;
    }
    // ========================================================================

    function resetStats() {
        totalDistance = 0; maxSpeed = 0; startTime = null; lastPosition = null;
        trackedPoints = [];
        distanceValueEl.textContent = '0.00 km';
        avgSpeedValueEl.textContent = '0 km/h';
        maxSpeedValueEl.textContent = '0 km/h';
        updateSpeedGauge(0);
        
        // MỚI: Xóa các đoạn vệt sáng cũ trên bản đồ
        tailSegments.forEach(segment => map.removeLayer(segment));
        tailSegments = [];
        currentTailIndex = 0;
    }

    function startTracking() {
        if (!('geolocation' in navigator)) { /*...*/ return; }
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
        watchId = null;
        lastPosition = null;
        updateSpeedGauge(0);
        infoTextEl.textContent = 'Đã dừng. Nhấn "Lưu" hoặc "Start".';
        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        if (trackedPoints.length > 1) {
            saveBtn.classList.remove('hidden');
            saveBtn.disabled = false;
        }
    }

    function updateSpeedGauge(speed) { /* ... (Không đổi) ... */ 
        const speedKmh = Math.round(speed);
        gaugeValueEl.textContent = speedKmh;
        const percentage = Math.min(speedKmh / MAX_SPEED_ON_GAUGE, 1);
        const offset = gaugeCircumference * (1 - percentage);
        gaugeProgressEl.style.strokeDashoffset = offset;
    }

    // ================== HÀM onSuccess ĐƯỢC CẬP NHẬT HOÀN TOÀN ==================
    function onSuccess(position) {
        if (!isTracking) return;

        const { latitude, longitude, speed, altitude, accuracy } = position.coords;
        const currentCoords = [latitude, longitude];
        const speedKmh = speed ? speed * 3.6 : 0;

        // Cập nhật các thông số (không đổi)
        updateSpeedGauge(speedKmh);
        maxSpeed = Math.max(maxSpeed, speedKmh);
        maxSpeedValueEl.textContent = `${Math.round(maxSpeed)} km/h`;
        
        // Tính toán khoảng cách và tốc độ T.B
        if (lastPosition) {
            const distanceIncrement = map.distance(
                [lastPosition.coords.latitude, lastPosition.coords.longitude],
                currentCoords
            );
            totalDistance += distanceIncrement;
            distanceValueEl.textContent = `${(totalDistance / 1000).toFixed(2)} km`;
            const elapsedTime = (position.timestamp - startTime) / 1000;
            if (elapsedTime > 0) {
                const avgSpeedKmh = (totalDistance / elapsedTime) * 3.6;
                avgSpeedValueEl.textContent = `${Math.round(avgSpeedKmh)} km/h`;
            }

            // --- LOGIC VẼ VỆT SÁNG ---
            // 1. Lấy vị trí của đoạn polyline hiện tại trong chuỗi
            const segment = tailSegments[currentTailIndex];
            const newSegmentCoords = [[lastPosition.coords.latitude, lastPosition.coords.longitude], currentCoords];

            if (segment) {
                // Nếu đoạn đã tồn tại, chỉ cần cập nhật tọa độ
                segment.setLatLngs(newSegmentCoords);
            } else {
                // Nếu chưa, tạo mới và thêm vào mảng
                tailSegments[currentTailIndex] = L.polyline(newSegmentCoords, {
                    weight: 5,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(map);
            }

            // 2. Cập nhật lại màu cho toàn bộ vệt sáng
            for (let i = 0; i < TAIL_LENGTH; i++) {
                const index = (currentTailIndex - i + TAIL_LENGTH) % TAIL_LENGTH;
                if (tailSegments[index]) {
                    // Segment càng gần i=0 (mới nhất) thì màu càng sáng
                    tailSegments[index].setStyle({ color: tailColors[i] || tailColors[TAIL_LENGTH - 1] });
                }
            }

            // 3. Di chuyển tới vị trí tiếp theo trong chuỗi (vòng lặp)
            currentTailIndex = (currentTailIndex + 1) % TAIL_LENGTH;

        } else {
            startTime = position.timestamp;
        }

        // Cập nhật vị trí cuối cùng và lưu điểm
        trackedPoints.push({ lat: latitude, lon: longitude, ele: altitude || 0, time: new Date(position.timestamp).toISOString() });
        lastPosition = position;
        infoTextEl.textContent = `Độ chính xác: ${Math.round(accuracy)}m`;

        // Cập nhật marker (không đổi)
        if (!userMarker) {
            const liveIcon = L.divIcon({
                className: 'location-dot',
                html: '<div class="location-ping"></div><div class="location-center"></div>',
                iconSize: [24, 24], iconAnchor: [12, 12]
            });
            userMarker = L.marker(currentCoords, { icon: liveIcon }).addTo(map);
            map.setView(currentCoords, 17);
        } else {
            userMarker.setLatLng(currentCoords);
        }
        map.panTo(currentCoords, { animate: true });
    }
    // =======================================================================

    function onError(error) { /* ... (Không đổi) ... */
        infoTextEl.textContent = `Lỗi GPS: ${error.message}`;
        if (isTracking) stopTracking();
    }

    function saveTrackAsGPX() { /* ... (Không đổi) ... */ 
        if (trackedPoints.length === 0) { alert('Không có dữ liệu lộ trình để lưu.'); return; }
        let gpxContent = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="GPS Speedometer Web App" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"><metadata><time>${new Date().toISOString()}</time></metadata><trk><name>Lộ trình được ghi lại</name><trkseg>`;
        trackedPoints.forEach(point => { gpxContent += `<trkpt lat="${point.lat}" lon="${point.lon}"><ele>${point.ele}</ele><time>${point.time}</time></trkpt>`; });
        gpxContent += `</trkseg></trk></gpx>`;
        const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date();
        const fileName = `track_${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}.gpx`;
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // --- GẮN SỰ KIỆN VÀ KHỞI TẠO ---
    startBtn.addEventListener('click', startTracking);
    stopBtn.addEventListener('click', stopTracking);
    saveBtn.addEventListener('click', saveTrackAsGPX);

    // MỚI: Tạo mảng màu và khởi tạo gauge
    tailColors = generateGradientColors('#00aaff', '#1a2332', TAIL_LENGTH);
    updateSpeedGauge(0);
});