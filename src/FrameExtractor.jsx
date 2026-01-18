import React, { useState, useRef, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import { 
  Upload, 
  Download, 
  Film, 
  Loader2, 
  Trash2, 
  Play, 
  Pause, 
  Camera, 
  Clock,
  Music,
  Scissors,
  Volume2,
  StopCircle,
  GripHorizontal,
  Activity,
  ChevronDown,
  ChevronUp,
  Images,
  Settings,
  AlertCircle
} from 'lucide-react';

export default function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtractingAudio, setIsExtractingAudio] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  
  const [frames, setFrames] = useState({ first: null, last: null, custom: null });
  const [error, setError] = useState('');
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Audio Panel State
  const [showAudioPanel, setShowAudioPanel] = useState(false);
  const [trimRange, setTrimRange] = useState({ start: 0, end: 0 });
  const [isPreviewing, setIsPreviewing] = useState(false);
  
  // Storyboard Settings
  const [storyboardFormat, setStoryboardFormat] = useState('png'); // 'png' or 'jpg'
  
  const [waveformData, setWaveformData] = useState([]);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);

  const [draggingHandle, setDraggingHandle] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const timelineRef = useRef(null);

  const processingVideoRef = useRef(null);
  const mainVideoRef = useRef(null);
  const canvasRef = useRef(null);

  const LARGE_FILE_THRESHOLD = 350 * 1024 * 1024; // 350 MB
  const MAX_STORYBOARD_DURATION = 60; // 60s limit for 10fps

  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  // --- AUDIO ANALYSIS ---
  const analyzeAudioWaveform = async (file) => {
    if (!file) return;
    setIsAnalyzingAudio(true);
    setWaveformData([]);

    try {
      if (file.size > LARGE_FILE_THRESHOLD && !isAnalyzingAudio) {
         setIsLargeFile(true);
         setIsAnalyzingAudio(false);
         return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0); 
      const samples = 200; 
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];

      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      const normalizedData = filteredData.map(n => n * multiplier);
      
      setWaveformData(normalizedData);
      setIsLargeFile(false);
    } catch (err) {
      console.error("Audio analysis warning:", err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };
  
  const forceAnalyzeAudio = () => {
      if (videoFile) {
          setIsLargeFile(false); 
          analyzeAudioWaveform(videoFile);
      }
  };

  // --- DRAG HANDLERS ---
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingHandle || !timelineRef.current || duration === 0) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      let mouseTime = (x / width) * duration;
      mouseTime = Math.max(0, Math.min(duration, mouseTime));

      setTrimRange(prev => {
        let nextRange = { ...prev };

        if (draggingHandle === 'start') {
          nextRange.start = Math.min(mouseTime, prev.end - 0.1);
          if (mainVideoRef.current && showAudioPanel) mainVideoRef.current.currentTime = nextRange.start;
        } 
        else if (draggingHandle === 'end') {
          nextRange.end = Math.max(mouseTime, prev.start + 0.1);
          if (mainVideoRef.current && showAudioPanel) mainVideoRef.current.currentTime = nextRange.end; 
        } 
        else if (draggingHandle === 'range') {
          const rangeDuration = prev.end - prev.start;
          let newStart = mouseTime - dragOffset;
          
          if (newStart < 0) newStart = 0;
          if (newStart + rangeDuration > duration) newStart = duration - rangeDuration;
          
          nextRange.start = newStart;
          nextRange.end = newStart + rangeDuration;
          
          if (mainVideoRef.current && showAudioPanel) mainVideoRef.current.currentTime = nextRange.start;
        }

        return nextRange;
      });
    };

    const handleMouseUp = () => {
      setDraggingHandle(null);
    };

    if (draggingHandle) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingHandle, duration, dragOffset, showAudioPanel]);

  const handleTimelineMouseDown = (e, handleType) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingHandle(handleType);

      if (handleType === 'range' && timelineRef.current) {
          const rect = timelineRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const mouseTime = (x / rect.width) * duration;
          setDragOffset(mouseTime - trimRange.start);
      }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFrames({ first: null, last: null, custom: null });
    setError('');
    setIsPlaying(false);
    setIsPreviewing(false);
    setCurrentTime(0);
    setDuration(0);
    setTrimRange({ start: 0, end: 0 });
    setWaveformData([]);
    setIsLargeFile(false);
    setShowAudioPanel(false);
    setZipProgress(0);
    setIsZipping(false);
    
    if (!file.type.startsWith('video/')) {
      setError('Пожалуйста, выберите видеофайл.');
      return;
    }

    if (file.size > LARGE_FILE_THRESHOLD) {
        setIsLargeFile(true);
    }

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setIsProcessing(true);
    
    // Auto start analysis
    analyzeAudioWaveform(file);
  };

  // --- CAPTURE LOGIC ---
  const captureFrame = (videoElement, time = null, format = 'png') => {
    return new Promise((resolve, reject) => {
      const processCapture = () => {
        try {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (!videoElement.videoWidth) {
             reject(new Error("Video not ready"));
             return;
          }

          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          
          const mime = format === 'png' ? 'image/png' : 'image/jpeg';
          const quality = format === 'png' ? undefined : 0.9; // 90% quality for JPG
          
          const imageUrl = canvas.toDataURL(mime, quality);
          resolve(imageUrl);
        } catch (err) {
          reject(err);
        }
      };

      if (time !== null) {
        videoElement.currentTime = time;
        const handleSeeked = () => {
            requestAnimationFrame(() => {
                processCapture();
            });
            videoElement.removeEventListener('seeked', handleSeeked);
        };
        videoElement.addEventListener('seeked', handleSeeked);
      } else {
        processCapture();
      }
    });
  };

  const processAutoFrames = async () => {
    const video = processingVideoRef.current;
    if (!video) return;

    try {
      await new Promise(r => setTimeout(r, 200));

      const firstFrame = await captureFrame(video, 0);
      
      let lastFrameTime = video.duration;
      if (lastFrameTime > 0.1) lastFrameTime -= 0.1;
      
      const lastFrame = await captureFrame(video, lastFrameTime);

      setFrames(prev => ({ ...prev, first: firstFrame, last: lastFrame }));
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  const handleManualCapture = async () => {
    if (!mainVideoRef.current) return;
    try {
      const customFrame = await captureFrame(mainVideoRef.current);
      setFrames(prev => ({ ...prev, custom: customFrame }));
    } catch (err) {
      console.error(err);
    }
  };

  // --- STORYBOARD (ZIP) GENERATION ---
  const handleGenerateStoryboard = async () => {
    const video = processingVideoRef.current;
    if (!videoFile || !video) return;

    if (duration > MAX_STORYBOARD_DURATION) {
        setError(`Видео слишком длинное (${formatTime(duration)}). Для режима 10 FPS лимит: ${formatTime(MAX_STORYBOARD_DURATION)} (до 600 кадров).`);
        return;
    }

    setIsZipping(true);
    setZipProgress(0);
    setError('');

    const zip = new JSZip();
    const folder = zip.folder("storyboard");
    const interval = 0.1; // 10 frames per second
    let currentTime = 0;
    let frameCount = 0;
    const totalFrames = Math.floor(duration / interval);
    const ext = storyboardFormat === 'png' ? 'png' : 'jpg';

    try {
        while (currentTime < duration) {
            // Seek
            video.currentTime = currentTime;
            await new Promise(resolve => {
                const onSeek = () => {
                    video.removeEventListener('seeked', onSeek);
                    resolve();
                };
                video.addEventListener('seeked', onSeek);
            });

            // Wait slight delay
            await new Promise(r => setTimeout(r, 50));

            // Capture with selected format
            const frameDataUrl = await captureFrame(video, null, storyboardFormat);
            const base64Data = frameDataUrl.split(',')[1];
            
            // Add to zip
            const timeStr = formatTime(currentTime).replace(':', '-').replace('.', '_');
            folder.file(`frame_${String(frameCount).padStart(4, '0')}_${timeStr}.${ext}`, base64Data, {base64: true});

            currentTime += interval;
            frameCount++;
            setZipProgress(Math.min(99, Math.round((frameCount / totalFrames) * 100)));
        }

        // Generate Zip
        const content = await zip.generateAsync({type:"blob"});
        const url = URL.createObjectURL(content);
        downloadFile(url, `${videoFile.name.split('.')[0]}_storyboard.${ext === 'png' ? 'zip' : 'zip'}`);
        setZipProgress(100);

    } catch (e) {
        console.error(e);
        setError("Ошибка при создании раскадровки.");
    } finally {
        setIsZipping(false);
        setTimeout(() => setZipProgress(0), 2000);
    }
  };

  // --- AUDIO LOGIC ---
  const bufferToWave = (abuffer, len) => {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1);
    setUint16(numOfChan); setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16);
    setUint32(0x61746164); setUint32(length - pos - 4);

    for(i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

    while(pos < len) {
      for(i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][pos])); 
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
        view.setInt16(44 + offset, sample, true); offset += 2;
      }
      pos++;
    }
    return new Blob([buffer], {type: "audio/wav"});
  };

  const handleExtractAudio = async (useTrim = false) => {
    if (!videoFile) return;
    if (useTrim && trimRange.end <= trimRange.start) {
        setError("Конец отрезка должен быть больше начала.");
        return;
    }

    setIsExtractingAudio(true);
    try {
      const arrayBuffer = await videoFile.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);

      let finalBuffer = originalBuffer;
      let finalLength = originalBuffer.length;

      if (useTrim) {
          const sampleRate = originalBuffer.sampleRate;
          const startSample = Math.floor(trimRange.start * sampleRate);
          const endSample = Math.floor(trimRange.end * sampleRate);
          
          const actualStart = Math.max(0, startSample);
          const actualEnd = Math.min(originalBuffer.length, endSample);
          const frameCount = actualEnd - actualStart;

          if (frameCount <= 0) throw new Error("Invalid audio length");

          const newBuffer = audioContext.createBuffer(originalBuffer.numberOfChannels, frameCount, sampleRate);

          for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
              const oldData = originalBuffer.getChannelData(i);
              const newData = newBuffer.getChannelData(i);
              for (let j = 0; j < frameCount; j++) newData[j] = oldData[j + actualStart];
          }
          finalBuffer = newBuffer;
          finalLength = frameCount;
      }

      const wavBlob = bufferToWave(finalBuffer, finalLength);
      const url = URL.createObjectURL(wavBlob);
      const suffix = useTrim ? `_cut_${trimRange.start.toFixed(1)}-${trimRange.end.toFixed(1)}` : '';
      downloadFile(url, `${videoFile.name.split('.')[0]}${suffix}.wav`);
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes('memory')) {
          setError("Файл слишком огромен для обработки в браузере.");
      } else {
          setError("Не удалось обработать аудио.");
      }
    } finally {
      setIsExtractingAudio(false);
    }
  };

  const togglePreview = () => {
    if (!mainVideoRef.current) return;

    if (isPreviewing) {
      mainVideoRef.current.pause();
      setIsPreviewing(false);
      setIsPlaying(false);
    } else {
      mainVideoRef.current.currentTime = trimRange.start;
      mainVideoRef.current.play();
      setIsPreviewing(true);
      setIsPlaying(true);
    }
  };

  const togglePlay = () => {
    if (!mainVideoRef.current) return;
    
    if (isPlaying) {
      mainVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      // If audio panel is open, respect trim start if we are out of bounds
      if (showAudioPanel) {
          if (mainVideoRef.current.currentTime < trimRange.start || mainVideoRef.current.currentTime >= trimRange.end) {
             mainVideoRef.current.currentTime = trimRange.start;
          }
      }
      mainVideoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (mainVideoRef.current) {
      const cur = mainVideoRef.current.currentTime;
      setCurrentTime(cur);

      if (showAudioPanel && isPreviewing && cur >= trimRange.end) {
        mainVideoRef.current.pause();
        setIsPreviewing(false);
        setIsPlaying(false);
        mainVideoRef.current.currentTime = trimRange.end;
      }
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (mainVideoRef.current) {
      mainVideoRef.current.currentTime = time;
      setCurrentTime(time);
      if (isPreviewing) {
        setIsPreviewing(false);
        setIsPlaying(false);
        mainVideoRef.current.pause();
      }
    }
  };

  const handleMainVideoLoaded = () => {
    if (mainVideoRef.current) {
      const dur = mainVideoRef.current.duration;
      setDuration(dur);
      setTrimRange({ start: 0, end: dur });
    }
  };

  const downloadFile = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const convertAndDownloadJPG = () => {
    if (!frames.custom) return;
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width = img.width;
      cvs.height = img.height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const url = cvs.toDataURL('image/jpeg', 0.9);
      downloadFile(url, `screenshot-${Math.floor(currentTime)}.jpg`);
    };
    img.src = frames.custom;
  };

  const resetApp = () => {
    setVideoFile(null);
    setVideoSrc(null);
    setFrames({ first: null, last: null, custom: null });
    setError('');
    setIsPlaying(false);
    setIsPreviewing(false);
    setWaveformData([]);
    setIsLargeFile(false);
    setShowAudioPanel(false);
    setZipProgress(0);
    setIsZipping(false);
  };

  const getPercent = (time) => duration > 0 ? (time / duration) * 100 : 0;

  const renderWaveform = useMemo(() => {
     if (waveformData.length === 0) return null;
     return (
         <div className="absolute inset-0 flex items-center justify-between px-1 opacity-50">
             {waveformData.map((value, idx) => (
                 <div 
                    key={idx} 
                    className="w-1 bg-blue-400/60 rounded-full"
                    style={{ 
                        height: `${Math.max(10, value * 100)}%`,
                        width: `${100 / waveformData.length}%`,
                        margin: '0 1px'
                    }}
                 />
             ))}
         </div>
     )
  }, [waveformData]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 text-center">
          <div className="inline-flex items-center justify-center bg-gradient-to-br from-blue-600/20 to-purple-600/20 p-4 rounded-2xl mb-4 border border-white/5">
            <Film className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent mb-2">
            Frame Master
          </h1>
          <p className="text-slate-400">
            Кадры из видео • Аудио в WAV • Раскадровка
          </p>
        </header>

        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-3xl p-6 shadow-2xl relative">
          
          {/* ZIP PROGRESS OVERLAY */}
          {isZipping && (
            <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center p-8">
                <div className="w-full max-w-md space-y-6 text-center">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
                        <h3 className="text-2xl font-bold text-white">Создание раскадровки...</h3>
                        <p className="text-slate-400 text-sm">Сканируем видео и создаем архив с картинками.</p>
                    </div>
                    
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm text-slate-300 font-mono">
                            <span>Прогресс</span>
                            <span>{zipProgress}%</span>
                        </div>
                        <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                            <div 
                                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300 ease-out"
                                style={{ width: `${zipProgress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>
            </div>
          )}

          {!videoFile ? (
            <div className="border-2 border-dashed border-slate-600 hover:border-blue-500 hover:bg-slate-800/80 rounded-2xl p-12 transition-all duration-300 group cursor-pointer relative overflow-hidden">
              <input 
                type="file" 
                accept="video/*" 
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex flex-col items-center justify-center text-slate-400 group-hover:text-blue-400 transition-colors relative z-0">
                <div className="bg-slate-700/50 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Upload className="w-10 h-10" />
                </div>
                <p className="text-xl font-semibold text-slate-200 group-hover:text-white">Загрузить видео</p>
                <p className="text-sm mt-2 opacity-60">MP4, MOV, WEBM (Обработка происходит в браузере)</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="bg-blue-500/20 p-2 rounded-lg shrink-0">
                    <Film className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="truncate">
                    <p className="font-medium truncate text-slate-200">{videoFile.name}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button 
                  onClick={resetApp}
                  className="p-2 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Сбросить</span>
                </button>
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                
                {/* Main Player Column */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="relative bg-black rounded-2xl overflow-hidden shadow-lg border border-slate-700/50 group">
                    <video 
                      ref={mainVideoRef}
                      src={videoSrc || ''}
                      className="w-full max-h-[450px] object-contain mx-auto"
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleMainVideoLoaded}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => {
                          if (!isPreviewing) setIsPlaying(false);
                      }}
                      onClick={togglePlay}
                    />
                    
                    {/* No Play Overlay here anymore as requested */}
                  </div>

                  {/* Main Controls */}
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-5">
                    
                    {/* Seeker */}
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={togglePlay}
                        className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full text-white transition-colors shadow-lg shadow-blue-900/20"
                      >
                        {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                      </button>
                      
                      <div className="flex-1 flex flex-col gap-1">
                        <input 
                          type="range" 
                          min="0" 
                          max={duration} 
                          step="0.01"
                          value={currentTime}
                          onChange={handleSeek}
                          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                        />
                        <div className="flex justify-between text-xs text-slate-400 font-mono">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="h-px bg-slate-700/50"></div>

                    {/* Primary Actions */}
                    <div className="grid grid-cols-2 gap-4">
                        <button 
                            onClick={handleManualCapture}
                            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-semibold transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
                        >
                            <Camera className="w-5 h-5" />
                            Сделать скриншот
                        </button>

                        <button 
                            onClick={() => setShowAudioPanel(!showAudioPanel)}
                            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all shadow-lg active:scale-[0.98] border
                                ${showAudioPanel 
                                    ? 'bg-amber-600 border-amber-500 text-white shadow-amber-900/20' 
                                    : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}
                        >
                            <Music className="w-5 h-5" />
                            Работа со звуком
                            {showAudioPanel ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                        </button>
                    </div>

                    {/* Collapsible Audio Panel */}
                    {showAudioPanel && (
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-amber-500/30 mt-2 animate-in fade-in slide-in-from-top-4 duration-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 text-amber-400 text-sm font-bold">
                                    <Scissors className="w-4 h-4" />
                                    <span>Выбор аудио-отрезка</span>
                                    {isAnalyzingAudio && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
                                </div>
                                <div className="flex gap-2 text-xs font-mono bg-black/30 px-2 py-1 rounded text-slate-300">
                                    <span>{formatTime(trimRange.start)}</span>
                                    <span className="text-slate-500">-</span>
                                    <span>{formatTime(trimRange.end)}</span>
                                    <span className="text-slate-500">|</span>
                                    <span className="text-amber-400">{formatTime(trimRange.end - trimRange.start)}</span>
                                </div>
                            </div>

                            {/* Timeline/Waveform */}
                            <div className="relative h-20 bg-slate-900 rounded-lg mb-4 select-none border border-slate-700 overflow-hidden" ref={timelineRef}>
                                {isLargeFile && waveformData.length === 0 ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/80 z-20">
                                        <p className="text-xs text-slate-400">Файл большой, график не загружен</p>
                                        <button 
                                            onClick={forceAnalyzeAudio}
                                            className="flex items-center gap-2 text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-white transition-colors"
                                        >
                                            <Activity className="w-3 h-3" />
                                            Показать волну
                                        </button>
                                    </div>
                                ) : (
                                    renderWaveform || (
                                        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs">
                                            {isAnalyzingAudio ? 'Анализ звука...' : 'Нет аудио'}
                                        </div>
                                    )
                                )}
                                
                                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                                    <div className="w-full h-0.5 bg-slate-500"></div>
                                </div>

                                <div 
                                    className="absolute top-0 bottom-0 bg-amber-500/20 border-t border-b border-amber-500/50 cursor-grab active:cursor-grabbing group hover:bg-amber-500/30 transition-colors"
                                    style={{
                                        left: `${getPercent(trimRange.start)}%`,
                                        width: `${getPercent(trimRange.end) - getPercent(trimRange.start)}%`
                                    }}
                                    onMouseDown={(e) => handleTimelineMouseDown(e, 'range')}
                                >
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <GripHorizontal className="w-6 h-6 text-amber-400/80 drop-shadow-md" />
                                    </div>
                                </div>

                                <div 
                                    className="absolute top-0 bottom-0 w-4 bg-amber-500 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center group z-10 transition-colors shadow-lg"
                                    style={{ left: `calc(${getPercent(trimRange.start)}% - 2px)` }}
                                    onMouseDown={(e) => handleTimelineMouseDown(e, 'start')}
                                >
                                    <div className="w-0.5 h-8 bg-black/50 rounded-full"></div>
                                </div>

                                <div 
                                    className="absolute top-0 bottom-0 w-4 bg-amber-500 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center group z-10 transition-colors shadow-lg"
                                    style={{ left: `calc(${getPercent(trimRange.end)}% - 14px)` }}
                                    onMouseDown={(e) => handleTimelineMouseDown(e, 'end')}
                                >
                                    <div className="w-0.5 h-8 bg-black/50 rounded-full"></div>
                                </div>
                                
                                <div 
                                    className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none z-0"
                                    style={{ left: `${getPercent(currentTime)}%` }}
                                ></div>
                            </div>

                            {/* Audio Actions */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button 
                                    onClick={togglePreview}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium transition-all text-sm
                                        ${isPreviewing 
                                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                                            : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
                                >
                                    {isPreviewing ? <StopCircle className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                    {isPreviewing ? 'Стоп' : 'Прослушать отрезок'}
                                </button>

                                <button 
                                    onClick={() => handleExtractAudio(true)}
                                    disabled={isExtractingAudio}
                                    className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2.5 rounded-lg font-semibold transition-all shadow-lg shadow-amber-900/20 active:scale-[0.98] text-sm"
                                >
                                    {isExtractingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    Скачать отрезок
                                </button>

                                <button 
                                    onClick={() => handleExtractAudio(false)}
                                    disabled={isExtractingAudio}
                                    className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-all text-sm border border-slate-600"
                                >
                                    <Download className="w-4 h-4" />
                                    Скачать всё
                                </button>
                            </div>
                        </div>
                    )}

                  </div>
                </div>

                {/* Right Column: Screenshots & Storyboard */}
                <div className="flex flex-col gap-4 h-full">
                  
                  {/* Manual Capture Result */}
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50 flex-1 flex flex-col">
                     <div className="flex items-center justify-between mb-3 text-emerald-400 font-medium">
                        <div className="flex items-center gap-2">
                          <Camera className="w-4 h-4" />
                          <span>Скриншот (Текущий момент)</span>
                        </div>
                      </div>
                      
                      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden relative min-h-[160px] flex items-center justify-center mb-3">
                        {frames.custom ? (
                          <img src={frames.custom} alt="Custom Frame" className="w-full h-full object-contain absolute inset-0" />
                        ) : (
                          <div className="text-center p-4 text-slate-500">
                            <p className="text-xs">Нажмите "Сделать скриншот" под плеером</p>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => frames.custom && downloadFile(frames.custom, `screenshot-${Math.floor(currentTime)}.png`)}
                        disabled={!frames.custom}
                        className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg transition-colors text-sm font-medium mb-2"
                      >
                        <Download className="w-4 h-4" />
                        Скачать PNG
                      </button>
                      
                      <button
                        onClick={convertAndDownloadJPG}
                        disabled={!frames.custom}
                        className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg transition-colors text-sm font-medium"
                      >
                        <Download className="w-4 h-4" />
                        Скачать JPG
                      </button>
                  </div>

                  {/* Storyboard Panel */}
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                        <Images className="w-4 h-4" />
                        Раскадровка (10 кадр/сек)
                      </h3>
                    </div>
                    
                    <div className="space-y-3">
                        {/* Format Selector */}
                        <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded-lg border border-slate-700">
                            <span className="text-xs text-slate-400 ml-1">Формат:</span>
                            <div className="flex gap-1">
                                <button 
                                    onClick={() => setStoryboardFormat('png')}
                                    className={`px-3 py-1 text-xs rounded-md transition-colors ${storyboardFormat === 'png' ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                                >
                                    PNG
                                </button>
                                <button 
                                    onClick={() => setStoryboardFormat('jpg')}
                                    className={`px-3 py-1 text-xs rounded-md transition-colors ${storyboardFormat === 'jpg' ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                                >
                                    JPG
                                </button>
                            </div>
                        </div>

                        <button 
                            onClick={handleGenerateStoryboard}
                            disabled={isZipping || isProcessing}
                            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2.5 rounded-xl font-medium transition-all shadow-lg shadow-purple-900/20 active:scale-[0.98] text-sm"
                        >
                            {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            {isZipping ? 'Создание архива...' : 'Скачать ZIP (Архив)'}
                        </button>
                        
                        <p className="text-[10px] text-slate-500 text-center">
                            Лимит 60 сек. PNG макс. качество, JPG легче.
                        </p>
                    </div>
                  </div>

                  {/* Auto Frames (First/Last) */}
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Авто (Старт / Финал)
                      </h3>
                      {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <div className="aspect-video bg-slate-800 rounded-lg overflow-hidden border border-slate-700 relative">
                           {frames.first ? (
                            <img src={frames.first} alt="Start" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full animate-pulse bg-slate-800" />
                          )}
                        </div>
                        <button
                          onClick={() => frames.first && downloadFile(frames.first, 'frame-start.png')}
                          disabled={!frames.first}
                          className="w-full text-xs py-1.5 bg-slate-700 hover:bg-blue-600 disabled:opacity-50 rounded text-slate-200 transition-colors"
                        >
                          Скачать старт
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="aspect-video bg-slate-800 rounded-lg overflow-hidden border border-slate-700 relative">
                           {frames.last ? (
                            <img src={frames.last} alt="End" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full animate-pulse bg-slate-800" />
                          )}
                        </div>
                        <button
                          onClick={() => frames.last && downloadFile(frames.last, 'frame-end.png')}
                          disabled={!frames.last}
                          className="w-full text-xs py-1.5 bg-slate-700 hover:bg-blue-600 disabled:opacity-50 rounded text-slate-200 transition-colors"
                        >
                          Скачать финал
                        </button>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* HIDDEN HELPERS */}
          <video 
            ref={processingVideoRef}
            src={videoSrc || ''}
            onLoadedMetadata={processAutoFrames}
            className="absolute opacity-0 -z-50 pointer-events-none" 
            crossOrigin="anonymous"
            muted
            preload="auto"
          />
          <canvas ref={canvasRef} className="hidden" />

          {error && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-center flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}