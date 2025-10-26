//app.js//
// Imagify - Image Compression Application
class Imagify {
    constructor() {
        // DOM element references
        this.originalCanvas = document.getElementById('originalCanvas');
        this.compressedCanvas = document.getElementById('compressedCanvas');
        this.heatMapCanvas = document.getElementById('heatMapCanvas');
        this.originalCtx = this.originalCanvas.getContext('2d');
        this.compressedCtx = this.compressedCanvas.getContext('2d');
        this.heatMapCtx = this.heatMapCanvas.getContext('2d');
        this.bestQualityBadge = document.getElementById('bestQualityBadge');

        // Application state
        this.originalImage = null;
        this.originalFile = null;
        this.currentQuality = 100; // Start at 100% quality
        this.originalSize = 0;
        this.compressedBlob = null; // Stores the blob currently displayed in the preview
        this.isProcessing = false; // Global processing flag
        this.debounceTimer = null;
        // **** FIX: Separate timer for dimension changes ****
        this.dimensionDebounceTimer = null;
        this.dragCounter = 0;

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const fileSelectBtn = document.getElementById('fileSelectBtn');

        // Centralized drag-and-drop event handling
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        uploadArea.addEventListener('dragenter', () => {
            this.dragCounter++;
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            this.dragCounter--;
            if (this.dragCounter === 0) {
                uploadArea.classList.remove('dragover');
            }
        });

        uploadArea.addEventListener('drop', e => {
            this.dragCounter = 0;
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });

        fileSelectBtn.addEventListener('click', () => {
            fileInput.value = ''; // Reset file input
            fileInput.click();
        });

        fileInput.addEventListener('change', e => {
            if (e.target.files?.length) {
                this.handleFileSelect(e.target.files[0]);
            }
        });

        // Compression controls
        document.getElementById('qualitySlider').addEventListener('input', e => {
            this.currentQuality = parseInt(e.target.value);
            document.getElementById('qualityValue').textContent = this.currentQuality;
            // Only need to debounce compression for quality slider
            this.debounceCompression();
        });

        // **** FIX: Use a new debounced function for dimension changes ****
        document.getElementById('maxWidth').addEventListener('input', () => {
            this.debounceRecalculationAndCompression();
        });
        document.getElementById('maxHeight').addEventListener('input', () => {
            this.debounceRecalculationAndCompression();
        });


        // Action buttons
        document.getElementById('resetBtn').addEventListener('click', () => this.resetToOriginal());
        document.getElementById('heatMapToggle').addEventListener('click', () => this.toggleHeatMap());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadCompressed());
    }

    // Debounce specifically for quality slider changes
    debounceCompression() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            if (this.originalImage && !this.isProcessing) { // Check flag
                this.compressImage();
            }
        }, 200); // Debounce time for responsiveness
    }

    // **** FIX: New debounced function for dimension changes ****
    // This will update the dead zone *then* compress
    debounceRecalculationAndCompression() {
        clearTimeout(this.dimensionDebounceTimer);
        this.dimensionDebounceTimer = setTimeout(async () => { // Make async
            if (this.originalImage && !this.isProcessing) { // Check flag before starting
                try {
                   this.showLoading(true); // Show loader for the combined operation
                   await this.updateDeadZoneHighlight(); // Wait for dead zone update
                   this.compressImage(); // Now compress (will hide loader on completion/error)
                } catch (error) {
                    console.error("Error during debounced recalculation/compression:", error);
                    this.showError("Failed to update image after dimension change.");
                    this.showLoading(false); // Ensure loader hides on error here too
                }
            } else if (this.isProcessing) {
                console.log("Skipping debounced recalculation: Already processing.");
            }
        }, 300); // Slightly longer debounce for dimension changes
    }


    async handleFileSelect(file) {
        // File validation
        if (!file) {
            this.showError('No file selected.');
            return;
        }
        if (!file.type.startsWith('image/')) {
            this.showError('Please select a valid image file (JPG, PNG, WebP).');
            return;
        }
        if (file.size > 10 * 1024 * 1024) { // 10MB limit
            this.showError('File size must be less than 10MB.');
            return;
        }

        this.originalFile = file;
        this.originalSize = file.size;
        this.showLoading(true); // Show loader ONCE here for the entire initial load
        this.hideError();
        this.isProcessing = true; // Set processing flag for the whole load

        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = async () => {
                try {
                    this.originalImage = img;
                    this.displayOriginalImage();
                    this.showMainContent();
                    // Reset UI
                    document.getElementById('qualitySlider').value = 100;
                    document.getElementById('qualityValue').textContent = '100';
                    document.getElementById('maxWidth').value = '';
                    document.getElementById('maxHeight').value = '';
                    this.currentQuality = 100;
                    // Update dead zone THEN trigger initial compression
                    await this.updateDeadZoneHighlight(); // Wait for it
                    this.compressImage(); // Start compression (will handle loader hiding)
                } catch (loadError) {
                    console.error("Error during image load processing:", loadError);
                    this.showError('Failed to process image load. Please try again.');
                    this.isProcessing = false; // Clear flag on error
                    this.showLoading(false); // Hide loader on critical error
                } finally {
                     // **** NOTE: isProcessing is reset by processFinalBlob on success ****
                }
            };
            img.onerror = () => {
                this.showError('Failed to load image. Please try another file.');
                this.isProcessing = false; // Clear flag on error
                this.showLoading(false);
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            this.showError('Failed to read file. Please try again.');
            this.isProcessing = false; // Clear flag on error
            this.showLoading(false);
        };
        reader.readAsDataURL(file);
    }

    async findDeadZoneThreshold() {
        if (!this.originalImage || !this.originalFile || this.originalSize === 0) {
             console.log("Skipping dead zone calculation: Missing image, file, or size.");
            return 101;
        }
        const { width, height } = this.calculateCompressionSize();
        if (width === 0 || height === 0) {
            console.warn("Skipping dead zone calculation: Target dimensions are zero.");
            return 101;
        }

        const testQualities = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 88, 85, 80, 75, 70];
        let thresholdQuality = 101;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');

        if (this.originalFile.type === 'image/png') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(this.originalImage, 0, 0, width, height);

        for (const quality of testQualities) {
            try {
                const blob = await new Promise((resolve) => {
                    tempCanvas.toBlob(blob => resolve(blob), 'image/jpeg', quality / 100);
                });

                if (blob && blob.size > this.originalSize) {
                    thresholdQuality = quality;
                    console.log(`(DZ Check) Quality ${quality}: Size ${blob.size} > Original ${this.originalSize}. Threshold might be here or lower.`);
                } else {
                    thresholdQuality = quality + 1;
                    console.log(`(DZ Check) Quality ${quality}: Size ${blob ? blob.size : 'N/A'} <= Original ${this.originalSize}. Dead zone starts at ${thresholdQuality}.`);
                    break;
                }
            } catch (error) {
                console.error(`Error checking blob size at quality ${quality}:`, error);
                thresholdQuality = quality + 1;
                break;
            }
        }
        thresholdQuality = Math.max(1, Math.min(thresholdQuality, 101));
        console.log(`Final dead zone threshold determined to start at quality: ${thresholdQuality}`);
        return thresholdQuality;
    }

    // **** FIX: Simplified isProcessing management ****
    async updateDeadZoneHighlight() {
        // Prevent calculation if no image (allow if isProcessing, let the caller manage)
        if (!this.originalImage) return;

        console.log("Updating dead zone highlight...");
        // Use a local processing flag specific to this function's async operation
        let dzIsProcessing = true;
        // this.showLoading(true); // Loader managed by caller

        try {
            const threshold = await this.findDeadZoneThreshold();
            let deadZoneWidth = 0;
            if (threshold <= 100) {
                deadZoneWidth = (100 - threshold) + 1;
            }
            document.documentElement.style.setProperty('--deadzone-width', `${deadZoneWidth}%`);
            console.log(`Set CSS --deadzone-width to: ${deadZoneWidth}%`);
        } catch(error) {
            console.error("Error updating dead zone highlight:", error);
            document.documentElement.style.setProperty('--deadzone-width', `0%`);
        } finally {
            dzIsProcessing = false; // Release local flag
            // this.showLoading(false); // Loader managed by caller
        }
    }


    displayOriginalImage() {
        const { width, height } = this.calculateDisplaySize(this.originalImage.width, this.originalImage.height, 400, 400);
        this.originalCanvas.width = width;
        this.originalCanvas.height = height;
        this.originalCtx.drawImage(this.originalImage, 0, 0, width, height);
        document.getElementById('originalSize').textContent = this.formatFileSize(this.originalSize);
    }

    calculateDisplaySize(originalWidth, originalHeight, maxWidth, maxHeight) {
      if (!originalWidth || !originalHeight) return { width: 0, height: 0};
        const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight, 1);
        return {
            width: Math.max(1, Math.round(originalWidth * ratio)),
            height: Math.max(1, Math.round(originalHeight * ratio))
        };
    }

    calculateCompressionSize() {
      if (!this.originalImage) return { width: 0, height: 0};
        const maxWidth = parseInt(document.getElementById('maxWidth').value) || this.originalImage.naturalWidth;
        const maxHeight = parseInt(document.getElementById('maxHeight').value) || this.originalImage.naturalHeight;
        const ratio = Math.min(maxWidth / this.originalImage.naturalWidth, maxHeight / this.originalImage.naturalHeight, 1);
        return {
            width: Math.max(1, Math.round(this.originalImage.naturalWidth * ratio)),
            height: Math.max(1, Math.round(this.originalImage.naturalHeight * ratio))
        };
    }


    compressImage() {
        // **** FIX: Check global flag ****
        if (!this.originalImage) return; // Allow if isProcessing, means it was called intentionally
        if (this.isProcessing && !this.originalImage) return; // Prevent if called while another op runs initially


        console.log("Starting compressImage...");
        this.isProcessing = true; // Set global flag
        this.showLoading(true); // Show loader specifically for compression

        try {
            const { width, height } = this.calculateCompressionSize();
            if (width === 0 || height === 0) {
                 throw new Error("Calculated compression dimensions are zero.");
            }
            const isResized = width !== this.originalImage.naturalWidth || height !== this.originalImage.naturalHeight;

            if (this.currentQuality === 100 && !isResized) {
                console.log("Quality 100% and no resize, using original file for preview.");
                // Still need to go through processFinalBlob to update metrics/UI correctly
                this.processFinalBlob(this.originalFile);
                return; // processFinalBlob will handle flags and loader
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const ctx = tempCanvas.getContext('2d');

            if (this.originalFile && this.originalFile.type === 'image/png') {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(this.originalImage, 0, 0, width, height);

            tempCanvas.toBlob(blob => {
                if (!blob) {
                    this.showError('Failed to compress image.');
                    this.isProcessing = false; // Clear flag on blob error
                    this.showLoading(false); // Hide loader on blob error
                    return;
                }
                this.processFinalBlob(blob); // Pass control
            }, 'image/jpeg', this.currentQuality / 100);

        } catch (error) {
            this.showError(`Compression error: ${error.message}`);
            this.isProcessing = false; // Clear flag on compression error
            this.showLoading(false); // Hide loader on compression error
        }
    }

    processFinalBlob(blob) {
        this.compressedBlob = blob; // Store the current preview blob
        const isUsingOriginal = blob === this.originalFile;
        this.bestQualityBadge.style.display = isUsingOriginal ? 'inline-block' : 'none';

        const img = new Image();
        img.onload = () => {
            try { // Wrap in try...finally for safety
                // 1. DISPLAY LOGIC
                const { width: displayWidth, height: displayHeight } = this.calculateDisplaySize(img.naturalWidth, img.naturalHeight, 400, 400);
                this.compressedCanvas.width = displayWidth;
                this.compressedCanvas.height = displayHeight;
                this.compressedCtx.drawImage(img, 0, 0, displayWidth, displayHeight);

                // 2. METRICS CALCULATION LOGIC
                const metricsCanvas = document.createElement('canvas');
                const metricsWidth = img.naturalWidth;
                const metricsHeight = img.naturalHeight;

                if (metricsWidth === 0 || metricsHeight === 0) {
                    console.error("Cannot calculate metrics: Image blob has zero dimensions.");
                    this.resetMetricsUI();
                } else {
                    metricsCanvas.width = metricsWidth;
                    metricsCanvas.height = metricsHeight;
                    const ctx = metricsCanvas.getContext('2d');
                    if (this.originalFile && this.originalFile.type === 'image/png') {
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, metricsWidth, metricsHeight);
                    }
                    ctx.drawImage(img, 0, 0);
                    this.calculateMetrics(metricsCanvas, blob);
                }

                // 3. UPDATE HEATMAP
                this.updateHeatMap();

            } catch(processError) {
                 console.error("Error during blob processing (display/metrics/heatmap):", processError);
                 this.showError("Failed to process compressed image data.");
                 this.resetMetricsUI(); // Reset metrics if processing fails
            } finally {
                 // 4. CLEANUP (ALWAYS RUNS)
                URL.revokeObjectURL(img.src);
                this.isProcessing = false; // **** FIX: Clear global flag HERE ****
                this.showLoading(false); // **** FIX: Hide loader HERE ****
                console.log("processFinalBlob finished.");
            }
        };
        img.onerror = () => {
            this.showError('Failed to display compressed image.');
            this.isProcessing = false; // Clear flag on display error
            this.showLoading(false); // Hide loader on display error
            this.resetMetricsUI();
        };
        img.src = URL.createObjectURL(blob);
    }

    resetMetricsUI() {
        document.getElementById('psnrValue').textContent = '-';
        document.getElementById('ssimValue').textContent = '-';
        document.getElementById('compressionRatio').textContent = '-';
        document.getElementById('sizeReduction').textContent = '-';
        document.getElementById('compressedSize').textContent = '-';
    }


    calculateMetrics(compressedImageCanvas, compressedBlob) {
       if (!this.originalImage || !this.originalFile) {
         console.warn("Cannot calculate metrics: Original image or file missing.");
         this.resetMetricsUI();
         return;
       }
        try {
            const compWidth = compressedImageCanvas.width;
            const compHeight = compressedImageCanvas.height;

            if (compWidth === 0 || compHeight === 0) {
                 console.warn("Cannot calculate metrics: Compressed canvas has zero dimensions.");
                 this.resetMetricsUI();
                 return;
            }

            const originalResizedCanvas = document.createElement('canvas');
            originalResizedCanvas.width = compWidth;
            originalResizedCanvas.height = compHeight;
            const origCtx = originalResizedCanvas.getContext('2d');

            if (this.originalFile.type === 'image/png') {
                 origCtx.fillStyle = '#FFFFFF';
                 origCtx.fillRect(0, 0, compWidth, compHeight);
            }
            origCtx.drawImage(this.originalImage, 0, 0, compWidth, compHeight);

            const originalData = origCtx.getImageData(0, 0, compWidth, compHeight);
            const compressedData = compressedImageCanvas.getContext('2d').getImageData(0, 0, compWidth, compHeight);

            const psnr = this.calculatePSNR(originalData, compressedData);
            const ssim = this.calculateSSIM(originalData, compressedData);

            const currentSize = compressedBlob.size;
            const compressionRatio = this.originalSize > 0 && currentSize > 0 ? this.originalSize / currentSize : 1;
            const sizeReduction = this.originalSize > 0 ? Math.max(0, ((this.originalSize - currentSize) / this.originalSize) * 100) : 0;

            document.getElementById('psnrValue').textContent = psnr.toFixed(2);
            document.getElementById('ssimValue').textContent = ssim.toFixed(4);
            document.getElementById('compressionRatio').textContent = compressionRatio.toFixed(1);
            document.getElementById('sizeReduction').textContent = sizeReduction.toFixed(1);
            document.getElementById('compressedSize').textContent = this.formatFileSize(currentSize);
        } catch (error) {
            console.error('Error calculating metrics:', error);
            this.resetMetricsUI();
        }
    }

    calculatePSNR(originalData, compressedData) {
        const d1 = originalData.data, d2 = compressedData.data;
        let mse = 0;
        let pixelCount = 0;
        for (let i = 0; i < d1.length; i += 4) {
            if (d1[i+3] < 255) continue;
            mse += (d1[i] - d2[i]) ** 2 + (d1[i + 1] - d2[i + 1]) ** 2 + (d1[i + 2] - d2[i + 2]) ** 2;
            pixelCount++;
        }
        if (pixelCount === 0) return 100;
        mse /= (pixelCount * 3);
        if (mse < 1e-10) return 100;
        return Math.max(0, 10 * Math.log10(255 ** 2 / mse));
    }

    calculateSSIM(img1, img2) {
        const K1 = 0.01, K2 = 0.03, L = 255;
        const C1 = (K1 * L) ** 2, C2 = (K2 * L) ** 2;
        const d1 = img1.data, d2 = img2.data;
        const width = img1.width, height = img1.height;
        const WINDOW_SIZE = 8;
        let totalSsim = 0, windowCount = 0;

        if (width < WINDOW_SIZE || height < WINDOW_SIZE) {
            console.warn("Image too small for SSIM calculation.");
            return 1;
        }

        for (let y = 0; y <= height - WINDOW_SIZE; y += WINDOW_SIZE) {
            for (let x = 0; x <= width - WINDOW_SIZE; x += WINDOW_SIZE) {
                let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
                let numPixels = 0;
                let windowHasOpaquePixel = false;

                for (let j = 0; j < WINDOW_SIZE; j++) {
                    for (let i = 0; i < WINDOW_SIZE; i++) {
                        const curX = x + i, curY = y + j;
                        const index = (curY * width + curX) * 4;

                        if (d1[index + 3] === 0) continue;
                        windowHasOpaquePixel = true;

                        const lumX = 0.299 * d1[index] + 0.587 * d1[index + 1] + 0.114 * d1[index + 2];
                        const lumY = 0.299 * d2[index] + 0.587 * d2[index + 1] + 0.114 * d2[index + 2];

                        sumX += lumX; sumY += lumY;
                        sumX2 += lumX ** 2; sumY2 += lumY ** 2;
                        sumXY += lumX * lumY;
                        numPixels++;
                    }
                }

                if (!windowHasOpaquePixel || numPixels === 0) continue;

                const meanX = sumX / numPixels;
                const meanY = sumY / numPixels;
                let varX = (sumX2 / numPixels) - (meanX ** 2);
                let varY = (sumY2 / numPixels) - (meanY ** 2);
                let covXY = (sumXY / numPixels) - (meanX * meanY);

                varX = Math.max(0, varX);
                varY = Math.max(0, varY);

                const ssim = ((2 * meanX * meanY + C1) * (2 * covXY + C2)) / ((meanX ** 2 + meanY ** 2 + C1) * (varX + varY + C2));
                totalSsim += ssim;
                windowCount++;
            }
        }
        return windowCount > 0 ? Math.max(0, Math.min(1, totalSsim / windowCount)) : 1;
    }


    updateHeatMap() {
        const heatMapOverlay = document.getElementById('heatMapOverlay');
        if (!heatMapOverlay || !heatMapOverlay.checkVisibility() || !this.originalImage || !this.compressedCtx) {
             if(this.heatMapCanvas) {
                 this.heatMapCtx.clearRect(0, 0, this.heatMapCanvas.width, this.heatMapCanvas.height);
             }
             return;
        }

        try {
            const displayWidth = this.compressedCanvas.width;
            const displayHeight = this.compressedCanvas.height;

            if (this.heatMapCanvas.width !== displayWidth || this.heatMapCanvas.height !== displayHeight) {
                this.heatMapCanvas.width = displayWidth;
                this.heatMapCanvas.height = displayHeight;
            }

            if (displayWidth === 0 || displayHeight === 0) {
                 console.warn("Skipping heatmap update: Display canvas has zero dimensions.");
                 return;
            }

            const heatMapImageData = this.heatMapCtx.createImageData(displayWidth, displayHeight);
            const heatMapData = heatMapImageData.data;

            const tempOriginalCanvas = document.createElement('canvas');
            tempOriginalCanvas.width = displayWidth;
            tempOriginalCanvas.height = displayHeight;
            const tempCtx = tempOriginalCanvas.getContext('2d');

            if (this.originalFile && this.originalFile.type === 'image/png') {
                tempCtx.fillStyle = '#FFFFFF';
                tempCtx.fillRect(0, 0, displayWidth, displayHeight);
            }
            tempCtx.drawImage(this.originalImage, 0, 0, displayWidth, displayHeight);

            const originalData = tempCtx.getImageData(0, 0, displayWidth, displayHeight).data;
            const compressedPixelData = this.compressedCtx.getImageData(0, 0, displayWidth, displayHeight).data; // Read directly from display

             if (!compressedPixelData) {
                 console.error("Could not get image data from compressed canvas for heatmap.");
                 return;
             }

            for (let i = 0; i < originalData.length; i += 4) {
                 if (originalData[i+3] < 255) {
                     heatMapData.set([0, 0, 0, 0], i);
                     continue;
                 }

                 const diff = (Math.abs(originalData[i] - compressedPixelData[i]) +
                                Math.abs(originalData[i + 1] - compressedPixelData[i + 1]) +
                                Math.abs(originalData[i + 2] - compressedPixelData[i + 2])) / 3;
                 const intensity = Math.min(1, diff / 255);
                 const { r, g, b } = this.getHeatMapColor(intensity);
                 const alpha = Math.max(30, intensity * 225);
                 heatMapData.set([r, g, b, alpha], i);
            }
            this.heatMapCtx.putImageData(heatMapImageData, 0, 0);
        } catch (error) {
            console.error('Error updating heat map:', error);
        }
    }


    getHeatMapColor(intensity) {
        const colors = [
            {r:0,   g:0,   b:255}, // Blue
            {r:0,   g:255, b:255}, // Cyan
            {r:0,   g:255, b:0},   // Green
            {r:255, g:255, b:0},   // Yellow
            {r:255, g:0,   b:0}    // Red
        ];
        intensity = Math.max(0, Math.min(1, intensity));
        const p = intensity * (colors.length - 1);
        const i = Math.floor(p);
        const j = Math.min(i + 1, colors.length - 1);
        const t = p - i;
        return {
            r: Math.round(colors[i].r * (1 - t) + colors[j].r * t),
            g: Math.round(colors[i].g * (1 - t) + colors[j].g * t),
            b: Math.round(colors[i].b * (1 - t) + colors[j].b * t),
        };
    }

    toggleHeatMap() {
        const overlay = document.getElementById('heatMapOverlay');
        const toggleBtn = document.getElementById('heatMapToggle');
        if (!overlay || !toggleBtn) return;

        const isCurrentlyHidden = !overlay.checkVisibility();
        overlay.style.display = isCurrentlyHidden ? 'flex' : 'none';
        toggleBtn.textContent = isCurrentlyHidden ? 'Hide Heat Map' : 'Show Heat Map';
        toggleBtn.classList.toggle('btn--secondary', isCurrentlyHidden);
        toggleBtn.classList.toggle('btn--outline', !isCurrentlyHidden);

        if (isCurrentlyHidden && this.compressedBlob) {
             this.updateHeatMap();
        }
    }


    async resetToOriginal() {
        console.log("Resetting to original...");
        if (this.isProcessing) {
             console.log("Cannot reset while processing.");
             return; // Don't reset if already busy
        }
        this.isProcessing = true; // Set flag for reset operation
        this.showLoading(true);   // Show loader for reset

        try {
            document.getElementById('qualitySlider').value = 100;
            document.getElementById('qualityValue').textContent = '100';
            document.getElementById('maxWidth').value = '';
            document.getElementById('maxHeight').value = '';
            this.currentQuality = 100;

            await this.updateDeadZoneHighlight(); // Recalculate DZ

            if (this.originalImage) {
                this.compressImage(); // Trigger compression (will hide loader)
            } else {
                // Clear UI if no image
                this.originalCtx.clearRect(0, 0, this.originalCanvas.width, this.originalCanvas.height);
                this.compressedCtx.clearRect(0, 0, this.compressedCanvas.width, this.compressedCanvas.height);
                this.heatMapCtx.clearRect(0, 0, this.heatMapCanvas.width, this.heatMapCanvas.height);
                document.getElementById('originalSize').textContent = '-';
                this.resetMetricsUI();
                document.documentElement.style.setProperty('--deadzone-width', `0%`);
                this.isProcessing = false; // Manually clear flag if no image
                this.showLoading(false);  // Manually hide loader if no image
            }
        } catch (error) {
             console.error("Error during reset:", error);
             this.showError("Failed to reset settings.");
             this.isProcessing = false; // Ensure flag is cleared on error
             this.showLoading(false); // Ensure loader is hidden on error
        }
    }

    downloadCompressed() {
        if (!this.compressedBlob) {
            this.showError('No compressed image available for download.');
            return;
        }
        if (!this.originalFile) {
            this.showError('Original file information is missing.');
            return;
        }

        let blobToDownload;
        let fileName;
        const originalNameParts = this.originalFile.name.split('.');
        const originalExt = originalNameParts.length > 1 ? originalNameParts.pop() : 'file';
        const originalBaseName = originalNameParts.join('.') || 'download';

        if (this.compressedBlob === this.originalFile) {
            blobToDownload = this.originalFile;
            fileName = `${originalBaseName}_original.${originalExt}`;
            console.log("Download Case 1: Using original file directly.");
        }
        else if (this.compressedBlob.size > this.originalFile.size && this.currentQuality !== 100) {
            blobToDownload = this.originalFile;
            fileName = `${originalBaseName}_original.${originalExt}`;
            this.showError(`Warning: Quality ${this.currentQuality}% file is larger (${this.formatFileSize(this.compressedBlob.size)}) than original (${this.formatFileSize(this.originalFile.size)}). Downloading original.`);
            console.log("Download Case 2: Compressed file larger, downloading original.");
        }
        else {
            blobToDownload = this.compressedBlob;
            fileName = `${originalBaseName}_compressed_q${this.currentQuality}.jpg`;
            console.log("Download Case 3: Using compressed file.");
        }

        try {
            const link = document.createElement('a');
            const objectUrl = URL.createObjectURL(blobToDownload);
            link.href = objectUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            this.showError(`Download failed: ${error.message}`);
             console.error('Download error:', error);
        }
    }

    formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
    }


    showMainContent() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('mainContent').style.display = 'grid';
    }

    showLoading(show) {
       const indicator = document.getElementById('loadingIndicator');
       if (indicator) {
           indicator.style.display = show ? 'flex' : 'none';
       }
    }

    showError(message) {
        const errorText = document.getElementById('errorText');
        if (errorText) {
            const errorDiv = errorText.parentElement;
            if (errorDiv) {
                const isWarning = message.toLowerCase().startsWith('warning:');
                errorDiv.style.background = isWarning ? 'rgba(var(--color-warning-rgb), 0.1)' : 'rgba(var(--color-error-rgb), 0.1)';
                errorDiv.style.borderColor = isWarning ? 'rgba(var(--color-warning-rgb), 0.3)' : 'rgba(var(--color-error-rgb), 0.3)';
                errorDiv.style.color = isWarning ? 'var(--color-warning)' : 'var(--color-error)';
                errorText.textContent = message;
                errorDiv.style.display = 'flex';

                setTimeout(() => {
                    if (errorDiv) errorDiv.style.display = 'none';
                }, 5000);
            }
        }
        console.log('Imagify Message:', message);
    }


    hideError() {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) errorDiv.style.display = 'none';
    }
}

// Initialize the application after the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Add a helper to check element visibility
        if (Element.prototype && !Element.prototype.checkVisibility) {
             Element.prototype.checkVisibility = function() {
                 return this && this.isConnected && !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length) && window.getComputedStyle(this).display !== 'none';
             }
        }
        new Imagify();
    } catch (error) {
        console.error('Failed to initialize Imagify:', error);
        document.body.innerHTML = '<h1 style="color: red; text-align: center; margin-top: 50px;">Error: Could not start the application. Please check the developer console for details.</h1>';
    }
});