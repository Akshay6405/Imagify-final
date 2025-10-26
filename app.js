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
        this.isProcessing = false;
        this.debounceTimer = null;
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
            this.debounceCompression();
        });

        document.getElementById('maxWidth').addEventListener('input', () => {
            this.debounceCompression();
            this.updateDeadZoneHighlight(); // Recalculate dead zone if dimensions change
        });
        document.getElementById('maxHeight').addEventListener('input', () => {
            this.debounceCompression();
            this.updateDeadZoneHighlight(); // Recalculate dead zone if dimensions change
        });


        // Action buttons
        document.getElementById('resetBtn').addEventListener('click', () => this.resetToOriginal());
        document.getElementById('heatMapToggle').addEventListener('click', () => this.toggleHeatMap());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadCompressed());
    }

    debounceCompression() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            if (this.originalImage) {
                this.compressImage();
            }
        }, 200); // Debounce time for responsiveness
    }

    async handleFileSelect(file) { // Make handleFileSelect async
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
        this.showLoading(true);
        this.hideError();

        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = async () => { // Make onload async
                this.originalImage = img;
                this.displayOriginalImage();
                this.showMainContent();
                // Reset UI FIRST
                document.getElementById('qualitySlider').value = 100;
                document.getElementById('qualityValue').textContent = '100';
                document.getElementById('maxWidth').value = '';
                document.getElementById('maxHeight').value = '';
                this.currentQuality = 100;
                // THEN update dead zone and trigger initial compression
                await this.updateDeadZoneHighlight(); // Await dead zone calculation
                this.compressImage(); // Trigger initial compression (runs async)
                this.showLoading(false); // Hide loading after setup is mostly done
            };
            img.onerror = () => {
                this.showError('Failed to load image. Please try another file.');
                this.showLoading(false);
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            this.showError('Failed to read file. Please try again.');
            this.showLoading(false);
        };
        reader.readAsDataURL(file);
    }

    // **** MODIFIED findDeadZoneThreshold ****
    // Async function to find the quality threshold where compressed size > original size
    async findDeadZoneThreshold() {
        // Return early if essential data is missing
        if (!this.originalImage || !this.originalFile || this.originalSize === 0) {
            console.log("Skipping dead zone calculation: Missing image, file, or size.");
            return 101; // Indicate no dead zone
        }

        // **** Use CURRENT compression dimensions for the test ****
        const { width, height } = this.calculateCompressionSize();
        if (width === 0 || height === 0) {
            console.warn("Skipping dead zone calculation: Target dimensions are zero.");
            return 101; // Avoid errors with zero dimensions
        }

        // Define quality levels to test (from high to lower)
        const testQualities = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 88, 85, 80, 75, 70]; // Added more points
        let thresholdQuality = 101; // Start assuming no dead zone (quality > 100)

        // Use a temporary canvas at the *calculated* dimensions
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width; // Use target width
        tempCanvas.height = height; // Use target height
        const ctx = tempCanvas.getContext('2d');

        // Draw white background if original was PNG to mimic JPEG conversion
        if (this.originalFile.type === 'image/png') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
        }
        // Draw the image resized to the target dimensions
        ctx.drawImage(this.originalImage, 0, 0, width, height);

        // Iterate through test qualities
        for (const quality of testQualities) {
            try {
                // Asynchronously get the blob for the current quality
                const blob = await new Promise((resolve) => {
                    tempCanvas.toBlob(blob => resolve(blob), 'image/jpeg', quality / 100);
                });

                // Check if blob exists and its size exceeds the original
                if (blob && blob.size > this.originalSize) {
                    // This quality level increases size, continue checking lower qualities
                    thresholdQuality = quality;
                    console.log(`(DZ Check) Quality ${quality}: Size ${blob.size} > Original ${this.originalSize}. Threshold might be here or lower.`);
                } else {
                    // This quality level *does not* increase size (or blob failed).
                    // The dead zone starts *just above* this quality level.
                    thresholdQuality = quality + 1;
                    console.log(`(DZ Check) Quality ${quality}: Size ${blob ? blob.size : 'N/A'} <= Original ${this.originalSize}. Dead zone starts at ${thresholdQuality}.`);
                    break; // Found the edge, stop checking
                }
            } catch (error) {
                console.error(`Error checking blob size at quality ${quality}:`, error);
                // On error, assume the dead zone starts above this quality as a fallback
                thresholdQuality = quality + 1;
                break;
            }
        }
         // Ensure the threshold is within the valid range [1, 101]
        thresholdQuality = Math.max(1, Math.min(thresholdQuality, 101));
        console.log(`Final dead zone threshold determined to start at quality: ${thresholdQuality}`);
        return thresholdQuality;
    }

    // Async function to update the CSS variable for the highlight
    async updateDeadZoneHighlight() {
        // Prevent calculation if processing or no image
        if (this.isProcessing || !this.originalImage) return;

        console.log("Updating dead zone highlight...");
        // Temporarily set processing flag during calculation to avoid conflicts
        this.isProcessing = true;
        this.showLoading(true); // Show loading indicator during this check

        try {
            const threshold = await this.findDeadZoneThreshold(); // Wait for threshold calculation
            let deadZoneWidth = 0; // Default width is 0%

            // If threshold is 100 or less, calculate the percentage width
            if (threshold <= 100) {
                // Width = (100 - threshold_start) + 1 (inclusive)
                deadZoneWidth = (100 - threshold) + 1;
            }

            // Set the CSS custom property on the root element
            document.documentElement.style.setProperty('--deadzone-width', `${deadZoneWidth}%`);
            console.log(`Set CSS --deadzone-width to: ${deadZoneWidth}%`);
        } catch(error) {
             console.error("Error updating dead zone highlight:", error);
             // Reset to default on error
             document.documentElement.style.setProperty('--deadzone-width', `0%`);
        } finally {
            this.isProcessing = false; // Release processing flag
            this.showLoading(false); // Hide loading indicator
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
      if (!originalWidth || !originalHeight) return { width: 0, height: 0}; // Handle missing dimensions
        const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight, 1);
        return {
            width: Math.max(1, Math.round(originalWidth * ratio)), // Ensure at least 1px
            height: Math.max(1, Math.round(originalHeight * ratio)) // Ensure at least 1px
        };
    }

    calculateCompressionSize() {
      if (!this.originalImage) return { width: 0, height: 0}; // Handle missing image
        const maxWidth = parseInt(document.getElementById('maxWidth').value) || this.originalImage.naturalWidth; // Use naturalWidth
        const maxHeight = parseInt(document.getElementById('maxHeight').value) || this.originalImage.naturalHeight; // Use naturalHeight
        const ratio = Math.min(maxWidth / this.originalImage.naturalWidth, maxHeight / this.originalImage.naturalHeight, 1);
        return {
            width: Math.max(1, Math.round(this.originalImage.naturalWidth * ratio)), // Ensure at least 1px
            height: Math.max(1, Math.round(this.originalImage.naturalHeight * ratio)) // Ensure at least 1px
        };
    }


    compressImage() {
        if (this.isProcessing || !this.originalImage) return;
        this.isProcessing = true;
        this.showLoading(true); // Show loading indicator during compression

        try {
            const { width, height } = this.calculateCompressionSize();
            if (width === 0 || height === 0) {
                 throw new Error("Calculated compression dimensions are zero.");
            }
            const isResized = width !== this.originalImage.naturalWidth || height !== this.originalImage.naturalHeight;

            // If quality is 100% and no resizing is done, use the original file to prevent size increase.
            // This ensures the 'Best Quality' badge works correctly initially.
            if (this.currentQuality === 100 && !isResized) {
                console.log("Quality 100% and no resize, using original file for preview.");
                this.processFinalBlob(this.originalFile);
                return; // Exit early
            }

            // Create a temporary canvas for compression
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
          	const ctx = tempCanvas.getContext('2d');

            // Handle transparency for PNGs. Draw a white background.
            // Otherwise, transparency will become black when saved as JPEG.
            if (this.originalFile && this.originalFile.type === 'image/png') {
                ctx.fillStyle = '#FFFFFF'; // White background
                ctx.fillRect(0, 0, width, height);
            }

            // Draw the original image onto the temporary canvas (potentially resized)
          	ctx.drawImage(this.originalImage, 0, 0, width, height);

            // Convert the temporary canvas to a JPEG blob at the current quality
            tempCanvas.toBlob(blob => {
                if (!blob) {
                    this.showError('Failed to compress image.');
                    this.isProcessing = false;
                    this.showLoading(false);
                    return;
                }

                // Always process the new blob for the preview to ensure real-time updates.
                // The size comparison logic is moved to the download function.
                this.processFinalBlob(blob, tempCanvas);

            }, 'image/jpeg', this.currentQuality / 100);

        } catch (error) {
            this.showError(`Compression error: ${error.message}`);
            this.isProcessing = false;
            this.showLoading(false);
        }
    }

    processFinalBlob(blob, sourceCanvas = null) {
        this.compressedBlob = blob; // Store the current preview blob

        // Determine if the original file is being displayed
        const isUsingOriginal = blob === this.originalFile;
        this.bestQualityBadge.style.display = isUsingOriginal ? 'inline-block' : 'none';

        const img = new Image();
        img.onload = () => {
            // Calculate the display size for the preview canvas
            const { width: displayWidth, height: displayHeight } = this.calculateDisplaySize(img.naturalWidth, img.naturalHeight, 400, 400); // Use naturalWidth/Height from loaded blob image
            this.compressedCanvas.width = displayWidth;
            this.compressedCanvas.height = displayHeight;
            // Draw the (potentially compressed) image onto the preview canvas
            this.compressedCtx.drawImage(img, 0, 0, displayWidth, displayHeight);

            // Determine which source to use for metric calculations
            // If using the original file blob, metrics should compare against the original image itself.
            // If using a compressed blob, metrics compare against the sourceCanvas (tempCanvas from compressImage).
            const metricsSource = isUsingOriginal ? this.originalImage : sourceCanvas;
            const metricsBlob = blob; // Use the current blob for size metrics

            if(metricsSource){
                // Need a canvas element to get ImageData for metrics
                let canvasForMetrics;
                if (metricsSource instanceof HTMLCanvasElement) {
                     canvasForMetrics = metricsSource;
                } else if (metricsSource instanceof HTMLImageElement) {
                     // Create a canvas from the image if needed, at its natural size
                     canvasForMetrics = document.createElement('canvas');
                     canvasForMetrics.width = metricsSource.naturalWidth; // Use natural dimensions
                     canvasForMetrics.height = metricsSource.naturalHeight;
                     const ctx = canvasForMetrics.getContext('2d');
                      // Draw white background if original was PNG *before* drawing image for accurate comparison
                     if (this.originalFile && this.originalFile.type === 'image/png') {
                         ctx.fillStyle = '#FFFFFF';
                         ctx.fillRect(0, 0, canvasForMetrics.width, canvasForMetrics.height);
                     }
                     ctx.drawImage(metricsSource, 0, 0); // Draw the image onto the canvas
                }

                if (canvasForMetrics && canvasForMetrics.width > 0 && canvasForMetrics.height > 0) {
                    this.calculateMetrics(canvasForMetrics, metricsBlob);
                    this.updateHeatMap(); // Update heatmap (now uses compressedCtx directly)
                } else {
                     console.error("Could not determine or create valid canvas for metrics calculation.");
                     this.resetMetricsUI();
                }
            } else {
                 console.error("Metrics source is null or undefined.");
                 this.resetMetricsUI(); // Reset metrics if source is missing
            }


            URL.revokeObjectURL(img.src); // Clean up object URL
            this.isProcessing = false;
            this.showLoading(false); // Hide loading indicator
        };
        img.onerror = () => {
            this.showError('Failed to display compressed image.');
            this.isProcessing = false;
            this.showLoading(false);
            this.resetMetricsUI(); // Reset metrics on display error
        };
        // Create an object URL from the blob to display the image
        img.src = URL.createObjectURL(blob);
    }

    // Helper to reset metrics display
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

            // Ensure dimensions are valid
            if (compWidth === 0 || compHeight === 0) {
                 console.warn("Cannot calculate metrics: Compressed canvas has zero dimensions.");
                 this.resetMetricsUI();
                 return;
            }

            // Create a canvas with the original image *at the same dimensions as the compressed one* for comparison
            const originalResizedCanvas = document.createElement('canvas');
            originalResizedCanvas.width = compWidth;
            originalResizedCanvas.height = compHeight;
            const origCtx = originalResizedCanvas.getContext('2d');

            // Draw white background if original was PNG for fair comparison against JPEG
            if (this.originalFile.type === 'image/png') {
                 origCtx.fillStyle = '#FFFFFF';
                 origCtx.fillRect(0, 0, compWidth, compHeight);
            }
          	origCtx.drawImage(this.originalImage, 0, 0, compWidth, compHeight);

            // Get image data for pixel-level comparison
            const originalData = origCtx.getImageData(0, 0, compWidth, compHeight);
            const compressedData = compressedImageCanvas.getContext('2d').getImageData(0, 0, compWidth, compHeight);

            // Calculate quality metrics
            const psnr = this.calculatePSNR(originalData, compressedData);
            const ssim = this.calculateSSIM(originalData, compressedData);

            // Calculate size metrics based on the actual blob being measured
            const currentSize = compressedBlob.size;
            const compressionRatio = this.originalSize > 0 && currentSize > 0 ? this.originalSize / currentSize : 1;
            // Clamp size reduction at 0% if the compressed size is larger
            const sizeReduction = this.originalSize > 0 ? Math.max(0, ((this.originalSize - currentSize) / this.originalSize) * 100) : 0;

            // Update UI elements
            document.getElementById('psnrValue').textContent = psnr.toFixed(2);
            document.getElementById('ssimValue').textContent = ssim.toFixed(4);
            document.getElementById('compressionRatio').textContent = compressionRatio.toFixed(1);
            document.getElementById('sizeReduction').textContent = sizeReduction.toFixed(1);
            document.getElementById('compressedSize').textContent = this.formatFileSize(currentSize);
        } catch (error) {
            console.error('Error calculating metrics:', error);
            this.resetMetricsUI(); // Reset metrics in UI on error
        }
    }

    calculatePSNR(originalData, compressedData) {
        const d1 = originalData.data, d2 = compressedData.data;
        let mse = 0;
        let pixelCount = 0; // Count only non-transparent pixels
        for (let i = 0; i < d1.length; i += 4) {
            // Skip transparent pixels in the original image from calculation
            if (d1[i+3] < 255) continue; // Consider only fully opaque pixels for PSNR
            mse += (d1[i] - d2[i]) ** 2 + (d1[i + 1] - d2[i + 1]) ** 2 + (d1[i + 2] - d2[i + 2]) ** 2;
            pixelCount++;
        }
        if (pixelCount === 0) return 100; // All transparent/semi-transparent, treat as perfect
        mse /= (pixelCount * 3); // Normalize by the number of counted opaque pixels
        if (mse < 1e-10) return 100; // Treat as perfect match if mse is very close to 0
        return Math.max(0, 10 * Math.log10(255 ** 2 / mse));
    }

    calculateSSIM(img1, img2) {
        const K1 = 0.01, K2 = 0.03, L = 255;
        const C1 = (K1 * L) ** 2, C2 = (K2 * L) ** 2;
        const d1 = img1.data, d2 = img2.data;
        const width = img1.width, height = img1.height;
        const WINDOW_SIZE = 8;
        let totalSsim = 0, windowCount = 0;

        // Ensure image is large enough for at least one window
        if (width < WINDOW_SIZE || height < WINDOW_SIZE) {
            console.warn("Image too small for SSIM calculation.");
            return 1; // Treat very small images as having perfect similarity
        }

        for (let y = 0; y <= height - WINDOW_SIZE; y += WINDOW_SIZE) { // Use <= for edge cases
            for (let x = 0; x <= width - WINDOW_SIZE; x += WINDOW_SIZE) { // Use <= for edge cases
                let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
                let numPixels = 0;
                let windowHasOpaquePixel = false; // Check if the window is entirely transparent

                for (let j = 0; j < WINDOW_SIZE; j++) {
                    for (let i = 0; i < WINDOW_SIZE; i++) {
                        const curX = x + i, curY = y + j;
                        const index = (curY * width + curX) * 4;

                        // Check alpha channel of the original image - skip fully transparent
                        if (d1[index + 3] === 0) continue;

                        windowHasOpaquePixel = true; // Mark that this window has data

                        // Calculate luminance (grayscale value)
                        const lumX = 0.299 * d1[index] + 0.587 * d1[index + 1] + 0.114 * d1[index + 2];
                        const lumY = 0.299 * d2[index] + 0.587 * d2[index + 1] + 0.114 * d2[index + 2];

                        sumX += lumX; sumY += lumY;
                        sumX2 += lumX ** 2; sumY2 += lumY ** 2;
                        sumXY += lumX * lumY;
                        numPixels++;
                    }
                }

                // If the window only contained transparent pixels, skip SSIM calculation for this window
                if (!windowHasOpaquePixel || numPixels === 0) continue;

                // Calculate statistics for the window
                const meanX = sumX / numPixels;
                const meanY = sumY / numPixels;
                let varX = (sumX2 / numPixels) - (meanX ** 2);
                let varY = (sumY2 / numPixels) - (meanY ** 2);
                let covXY = (sumXY / numPixels) - (meanX * meanY);

                // Handle potential floating point inaccuracies leading to negative variance
                varX = Math.max(0, varX);
                varY = Math.max(0, varY);

                // Calculate SSIM for the window (standard formula)
                const ssim = ((2 * meanX * meanY + C1) * (2 * covXY + C2)) / ((meanX ** 2 + meanY ** 2 + C1) * (varX + varY + C2));

                totalSsim += ssim;
                windowCount++;
            }
        }

        // Average SSIM over all valid windows
        return windowCount > 0 ? Math.max(0, Math.min(1, totalSsim / windowCount)) : 1; // Return 1 if no opaque windows
    }


    // **** MODIFIED updateHeatMap - no longer needs canvas param ****
    updateHeatMap() {
        const heatMapOverlay = document.getElementById('heatMapOverlay');
        // Check visibility and ensure both original image and compressed canvas context exist
        if (!heatMapOverlay || !heatMapOverlay.checkVisibility() || !this.originalImage || !this.compressedCtx) {
             if(this.heatMapCanvas) { // Clear heatmap if not visible or data missing
                 this.heatMapCtx.clearRect(0, 0, this.heatMapCanvas.width, this.heatMapCanvas.height);
             }
             return;
        }

        try {
            // Use the dimensions of the *displayed* compressed canvas
            const displayWidth = this.compressedCanvas.width;
            const displayHeight = this.compressedCanvas.height;

            // Ensure heatmap canvas matches the display canvas size
            if (this.heatMapCanvas.width !== displayWidth || this.heatMapCanvas.height !== displayHeight) {
                this.heatMapCanvas.width = displayWidth;
                this.heatMapCanvas.height = displayHeight;
            }

            // Check for zero dimensions before creating ImageData
            if (displayWidth === 0 || displayHeight === 0) {
                 console.warn("Skipping heatmap update: Display canvas has zero dimensions.");
                 return;
            }

            const heatMapImageData = this.heatMapCtx.createImageData(displayWidth, displayHeight);
            const heatMapData = heatMapImageData.data;

            // Create a temporary canvas for the original image resized to *display* dimensions
            const tempOriginalCanvas = document.createElement('canvas');
            tempOriginalCanvas.width = displayWidth;
            tempOriginalCanvas.height = displayHeight;
          	const tempCtx = tempOriginalCanvas.getContext('2d');

            // Handle PNG transparency for heatmap diff base layer
            if (this.originalFile && this.originalFile.type === 'image/png') {
                tempCtx.fillStyle = '#FFFFFF'; // Use white background for diff
                tempCtx.fillRect(0, 0, displayWidth, displayHeight);
            }
          	tempCtx.drawImage(this.originalImage, 0, 0, displayWidth, displayHeight); // Draw original resized

            // Get image data from the resized original and the *displayed* compressed image
            const originalData = tempCtx.getImageData(0, 0, displayWidth, displayHeight).data;
            const compressedData = this.compressedCtx.getImageData(0, 0, displayWidth, displayHeight); // Data directly from the display canvas

             if (!compressedData) {
                 console.error("Could not get image data from compressed canvas for heatmap.");
                 return;
             }
             const compressedPixelData = compressedData.data;

            // Calculate difference and apply heatmap color
            for (let i = 0; i < originalData.length; i += 4) {
              // Skip transparent areas in the original from the heatmap diff
              if (originalData[i+3] < 255) { // Skip semi-transparent too for clarity
                  heatMapData.set([0, 0, 0, 0], i); // Make heatmap transparent here too
                  continue;
              }

              // Calculate average absolute difference across RGB channels
                const diff = (Math.abs(originalData[i] - compressedPixelData[i]) +
                              Math.abs(originalData[i + 1] - compressedPixelData[i + 1]) +
                              Math.abs(originalData[i + 2] - compressedPixelData[i + 2])) / 3;
                const intensity = Math.min(1, diff / 255); // Clamp intensity 0-1
                const { r, g, b } = this.getHeatMapColor(intensity);
              // Set heatmap pixel color and alpha (more difference = more opaque red)
              const alpha = Math.max(30, intensity * 225); // Adjusted alpha range slightly
                heatMapData.set([r, g, b, alpha], i);
            }
            // Put the generated heatmap data onto its canvas
            this.heatMapCtx.putImageData(heatMapImageData, 0, 0);
        } catch (error) {
            console.error('Error updating heat map:', error);
        }
    }


    getHeatMapColor(intensity) {
        // Simple heatmap: Blue (low diff) -> Green -> Yellow -> Red (high diff)
        const colors = [
            {r:0,   g:0,   b:255}, // Blue
            {r:0,   g:255, b:255}, // Cyan
            {r:0,   g:255, b:0},   // Green
            {r:255, g:255, b:0},   // Yellow
            {r:255, g:0,   b:0}    // Red
        ];
        // Clamp intensity just in case
        intensity = Math.max(0, Math.min(1, intensity));
        const p = intensity * (colors.length - 1); // Position in the color array
        const i = Math.floor(p); // Index of the lower color stop
        const j = Math.min(i + 1, colors.length - 1); // Index of the upper color stop
        const t = p - i; // Interpolation factor (0 to 1) between stops i and j

        // Linear interpolation between the two color stops
        return {
            r: Math.round(colors[i].r * (1 - t) + colors[j].r * t),
            g: Math.round(colors[i].g * (1 - t) + colors[j].g * t),
            b: Math.round(colors[i].b * (1 - t) + colors[j].b * t),
        };
    }

    toggleHeatMap() {
        const overlay = document.getElementById('heatMapOverlay');
        const toggleBtn = document.getElementById('heatMapToggle');
        if (!overlay || !toggleBtn) return; // Exit if elements not found

        // Use checkVisibility helper
        const isCurrentlyHidden = !overlay.checkVisibility();

        overlay.style.display = isCurrentlyHidden ? 'flex' : 'none'; // Use flex to center canvas
        toggleBtn.textContent = isCurrentlyHidden ? 'Hide Heat Map' : 'Show Heat Map';
        toggleBtn.classList.toggle('btn--secondary', isCurrentlyHidden);
        toggleBtn.classList.toggle('btn--outline', !isCurrentlyHidden);

        // If showing the heatmap, ensure it's up-to-date
        if (isCurrentlyHidden && this.compressedBlob) {
             // Directly call updateHeatMap as processFinalBlob already ran
             this.updateHeatMap();
        }
    }


    async resetToOriginal() { // Make async
        console.log("Resetting to original...");
        document.getElementById('qualitySlider').value = 100;
        document.getElementById('qualityValue').textContent = '100';
        document.getElementById('maxWidth').value = '';
        document.getElementById('maxHeight').value = '';
        this.currentQuality = 100;

        // Update the dead zone highlight based on the original image (and default dimensions)
        // Await this calculation before triggering compression
        await this.updateDeadZoneHighlight();

        // Trigger compression at 100% quality
        if (this.originalImage) {
           this.compressImage(); // Let compression run async
        } else {
            // If no original image, clear canvases and metrics
            this.originalCtx.clearRect(0, 0, this.originalCanvas.width, this.originalCanvas.height);
            this.compressedCtx.clearRect(0, 0, this.compressedCanvas.width, this.compressedCanvas.height);
            this.heatMapCtx.clearRect(0, 0, this.heatMapCanvas.width, this.heatMapCanvas.height);
            document.getElementById('originalSize').textContent = '-';
            this.resetMetricsUI();
            // Reset dead zone highlight if no image
            document.documentElement.style.setProperty('--deadzone-width', `0%`);
        }
    }

    downloadCompressed() {
        // Check if there's a blob ready for download (could be original or compressed)
        if (!this.compressedBlob) {
            this.showError('No compressed image available for download.');
            return;
        }
        if (!this.originalFile) {
            this.showError('Original file information is missing.');
            return;
        }

        // Determine which blob to download based on size optimization
        let blobToDownload;
        let fileName;
        const originalNameParts = this.originalFile.name.split('.');
        const originalExt = originalNameParts.length > 1 ? originalNameParts.pop() : 'file'; // Handle names with no extension
        const originalBaseName = originalNameParts.join('.') || 'download'; // Handle names starting with '.'

        // Case 1: The current preview blob *is* the original file (quality=100, no resize)
        if (this.compressedBlob === this.originalFile) {
            blobToDownload = this.originalFile;
            fileName = `${originalBaseName}_original.${originalExt}`;
            console.log("Download Case 1: Using original file directly.");
        }
        // Case 2: The current preview blob is compressed but LARGER than the original
        // AND the user hasn't explicitly chosen 100% quality (which is handled by Case 1)
        else if (this.compressedBlob.size > this.originalFile.size && this.currentQuality !== 100) {
            blobToDownload = this.originalFile; // Download original instead
            fileName = `${originalBaseName}_original.${originalExt}`;
            // Show a transient message (using the error style for visibility)
            this.showError(`Warning: Quality ${this.currentQuality}% file is larger (${this.formatFileSize(this.compressedBlob.size)}) than original (${this.formatFileSize(this.originalFile.size)}). Downloading original.`);
            console.log("Download Case 2: Compressed file larger, downloading original.");
        }
        // Case 3: The current preview blob is compressed and smaller (or equal size)
        else {
            blobToDownload = this.compressedBlob;
            // Generate a filename indicating the quality level
            fileName = `${originalBaseName}_compressed_q${this.currentQuality}.jpg`;
            console.log("Download Case 3: Using compressed file.");
        }

        try {
            // Create a temporary link element for download
            const link = document.createElement('a');
            const objectUrl = URL.createObjectURL(blobToDownload); // Create URL for the chosen blob
            link.href = objectUrl;
            link.download = fileName; // Set the determined filename

            // Programmatically click the link to trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link); // Clean up the link element

            // Revoke the object URL to free up memory
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            this.showError(`Download failed: ${error.message}`);
            console.error('Download error:', error);
        }
    }

    formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B'; // Handle zero or negative bytes
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
        // Ensure it uses 'flex' to work with the centering CSS
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
                // Determine if it's a warning or error based on message content
                const isWarning = message.toLowerCase().startsWith('warning:');
                // Apply styles based on warning/error
                errorDiv.style.background = isWarning ? 'rgba(var(--color-warning-rgb), 0.1)' : 'rgba(var(--color-error-rgb), 0.1)';
                errorDiv.style.borderColor = isWarning ? 'rgba(var(--color-warning-rgb), 0.3)' : 'rgba(var(--color-error-rgb), 0.3)';
                errorDiv.style.color = isWarning ? 'var(--color-warning)' : 'var(--color-error)';
                errorText.textContent = message;
                errorDiv.style.display = 'flex'; // Show the message

                // Automatically hide the message after 5 seconds
                setTimeout(() => {
                    if (errorDiv) errorDiv.style.display = 'none';
                }, 5000);
            }
        }
        // Log all messages to console regardless of UI state
        console.log('Imagify Message:', message); // Use log or warn/error as appropriate
    }


    hideError() {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) errorDiv.style.display = 'none';
    }
}

// Initialize the application after the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Add a helper to check element visibility (useful for the heatmap)
        // Ensure this prototype is added safely
        if (Element.prototype && !Element.prototype.checkVisibility) {
             Element.prototype.checkVisibility = function() {
                 // More robust check: element exists, is in DOM, and is visible
                 return this && this.isConnected && !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length) && window.getComputedStyle(this).display !== 'none';
             }
        }
        new Imagify(); // Instantiate the application class
    } catch (error) {
        console.error('Failed to initialize Imagify:', error);
        // Provide a fallback message in case of critical initialization errors
        document.body.innerHTML = '<h1 style="color: red; text-align: center; margin-top: 50px;">Error: Could not start the application. Please check the developer console for details.</h1>';
    }
});