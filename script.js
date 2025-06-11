document.addEventListener('DOMContentLoaded', function () {
    // --- BIẾN DOM ---
    const liveDashboard = document.getElementById('live-dashboard');
    const gpxInfoEl = document.getElementById('gpx-info');
    const gpxFileInput = document.getElementById('gpx-file');
    const infoTextEl = document.getElementById('info-text');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const saveBtn = document.getElementById('btn-save');
    // ... các biến DOM khác không đổi ...
    const distanceValueEl = document.getElementById('distance-value');
    const avgSpeedValueEl = document.getElementById('avg-speed-value');
    const maxSpeedValueEl = document.getElementById('max-speed-value');
    const gaugeProgressEl = document.querySelector('.gauge-progress');
    const gaugeValueEl = document.querySelector('.gauge-value');

    // --- CÁC BIẾN VÀ CÀI ĐẶT (Không đổi) ---
    const gaugeRadius = 54, gaugeCircumference = 2 * Math.PI * gaugeRadius, MAX_SPEED_ON_GAUGE = 150;
    gaugeProgressEl.style.strokeDasharray = gaugeCircumference;
    let isTracking = false, watchId = null, trackedPoints = [], userMarker;
    let totalDistance = 0, maxSpeed = 0, startTime = null, lastPosition = null;
    const TAIL_LENGTH = 70;
    let tailSegments = [], tailColors = [], currentTailIndex = 0;

    // --- KHỞI TẠO BẢN ĐỒ (Không đổi) ---
    const map = L.map('map').setView([16.047079, 108.206230], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { /* ... attribution ... */ }).addTo(map);

    // --- CÁC HÀM HELPER (Không đổi) ---
    function generateGradientColors(start, end, steps) { /* ... (Không đổi) ... */ 
        const startRGB = parseInt(start.slice(1), 16), r1 = (startRGB >> 16) & 255, g1 = (startRGB >> 8) & 255, b1 = startRGB & 255;
        const endRGB = parseInt(end.slice(1), 16), r2 = (endRGB >> 16) & 255, g2 = (endRGB >> 8) & 255, b2 = endRGB & 255;
        const colors = [];
        for (let i = 0; i < steps; i++) {
            const ratio = i / (steps - 1);
            const r = Math.round(r1 + ratio * (r2 - r1)), g = Math.round(g1 + ratio * (g2 - g1)), b = Math.round(b1 + ratio * (b2 - b1));
            colors.push(`#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`);
        } return colors;
    }
    function updateSpeedGauge(speed) { /* ... (Không đổi) ... */ }

    function resetStats() {
        totalDistance = 0, maxSpeed = 0, startTime = null, lastPosition = null;
        trackedPoints = []; distanceValueEl.textContent = '0.00 km';
        avgSpeedValueEl.textContent = '0 km/h'; maxSpeedValueEl.textContent = '0 km/h';
        updateSpeedGauge(0);
        tailSegments.forEach(segment => map.removeLayer(segment));
        tailSegments = [], currentTailIndex = 0;
    }

    function startTracking() {
        // ... (Logic không đổi, nhưng đảm bảo giao diện đúng)
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

    // ================== SỬA LỖI LOGIC HIỂN THỊ NÚT LƯU ==================
    function stopTracking() {
        isTracking = false;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = null; lastPosition = null; updateSpeedGauge(0);
        infoTextEl.textContent = 'Đã dừng. Nhấn "Lưu" hoặc "Start".';
        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');

        // Sửa điều kiện: một lộ trình cần ít nhất 2 điểm để có ý nghĩa
        if (trackedPoints.length > 1) {
            saveBtn.classList.remove('hidden');
            saveBtn.disabled = false;
        }
    }
    // ====================================================================

    function onSuccess(position) { /* ... (Toàn bộ hàm này không đổi) ... */ }
    function onError(error) { /* ... (Không đổi) ... */ }
    function saveTrackAsGPX() { /* ... (Không đổi) ... */ }

    // ================== KHÔI PHỤC HÀM XỬ LÝ FILE GPX ==================
    function handleGPXUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Ẩn bảng điều khiển thời gian thực và các nút, hiện bảng thông tin GPX
        liveDashboard.classList.add('hidden');
        controls.classList.add('hidden');
        gpxInfoEl.classList.remove('hidden');
        gpxInfoEl.innerHTML = `<p>Đang đọc file: ${file.name}...</p>`;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const gpxContent = e.target.result;
                const parser = new DOMParser();
                const gpx = parser.parseFromString(gpxContent, "text/xml");
                
                // Xóa các layer cũ trên bản đồ
                map.eachLayer(layer => {
                    if (layer instanceof L.Polyline || layer instanceof L.Marker) {
                        map.removeLayer(layer);
                    }
                });

                const trackpoints = gpx.querySelectorAll('trkpt');
                if (trackpoints.length === 0) {
                    gpxInfoEl.innerHTML = `<p style="color:var(--stop-color);">Lỗi: File GPX không chứa điểm tọa độ nào.</p>`;
                    return;
                }

                const latlngs = [];
                trackpoints.forEach(point => {
                    latlngs.push([
                        parseFloat(point.getAttribute('lat')),
                        parseFloat(point.getAttribute('lon'))
                    ]);
                });
                
                const polyline = L.polyline(latlngs, { color: 'var(--accent-color)', weight: 4 }).addTo(map);
                map.fitBounds(polyline.getBounds());

                // Tính toán thông tin
                let totalDistance = 0;
                for (let i = 0; i < latlngs.length - 1; i++) {
                    totalDistance += map.distance(latlngs[i], latlngs[i+1]);
                }

                // Hiển thị thông tin
                gpxInfoEl.innerHTML = `
                    <h2>Thông tin Lộ trình GPX</h2>
                    <p>Tên file: <span>${file.name}</span></p>
                    <p>Số điểm: <span>${trackpoints.length}</span></p>
                    <p>Tổng quãng đường: <span>${(totalDistance / 1000).toFixed(2)} km</span></p>
                `;
            } catch (err) {
                gpxInfoEl.innerHTML = `<p style="color:var(--stop-color);">Lỗi khi đọc file. File có thể bị hỏng hoặc không đúng định dạng GPX.</p>`;
            }
        };
        reader.onerror = function() {
             gpxInfoEl.innerHTML = `<p style="color:var(--stop-color);">Không thể đọc file.</p>`;
        };
        reader.readAsText(file);
    }
    // =======================================================================

    // --- GẮN SỰ KIỆN VÀ KHỞI TẠO ---
    startBtn.addEventListener('click', startTracking);
    stopBtn.addEventListener('click', stopTracking);
    saveBtn.addEventListener('click', saveTrackAsGPX);
    gpxFileInput.addEventListener('change', handleGPXUpload); // Thêm lại event listener

    tailColors = generateGradientColors('#00aaff', '#1a2332', TAIL_LENGTH);
    updateSpeedGauge(0);
});
