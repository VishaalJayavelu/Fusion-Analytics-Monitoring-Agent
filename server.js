const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const os = require('os');
const si = require('systeminformation');

const fs = require('fs');
const basicAuth = require('express-basic-auth');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

// Enable CORS
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    preflightContinue: false,
    optionsSuccessStatus: 204,
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 3600,
  })
);

// JSON parser
app.use(express.json());

// Basic authentication if username and password are provided
if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD) {
  const users = {};
  users[process.env.AUTH_USERNAME] = process.env.AUTH_PASSWORD;
  
  app.use(basicAuth({
    users,
    challenge: true,
    realm: 'VM Monitoring Agent'
  }));
}

app.use("*", (req, res, next) => {
  console.log("Request received", req.originalUrl);
  next();
});

const formatBytesSmart = (bytes) => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
};


// Detect operating system
const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';
let cachedStaticInfo = null;
let lastCachedTime = 0;

const getStaticInfo = async () => {
  if (cachedStaticInfo && ((Date.now() - lastCachedTime) < 0.5 * 60 * 1000)) {
    return cachedStaticInfo;
  }
  const [osInfo, cpuInfo, graphicsInfo] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.graphics()
  ]);
  cachedStaticInfo = { osInfo, cpuInfo, graphicsInfo };
  lastCachedTime = Date.now();
  return cachedStaticInfo;
};

const getSystemInfo = async () => {
  const { osInfo, cpuInfo, graphicsInfo } = await getStaticInfo();
  const [memInfo, diskUsage, netInfo, batteryInfo] = await Promise.all([
    si.mem(),
    si.fsSize(),
    si.networkInterfaces(),
    si.battery()
  ]);

  const totalMem = memInfo.total;
  const freeMem = memInfo.free;
  const usedMem = totalMem - freeMem;
  const memUsagePercent = (usedMem / totalMem) * 100;
  
  const activeMem = memInfo.active;
  const availableMem = memInfo.available;
  const buffersMem = memInfo.buffers;
  const cachedMem = memInfo.cached;

  const swapTotal = memInfo.swaptotal;
  const swapUsed = memInfo.swapused;
  const swapFree = memInfo.swapfree;
  const swapUsagePercent = (swapUsed / swapTotal) * 100;


  let totalDisk = 0, usedDisk = 0;
  const diskDetails = diskUsage.map(disk => {
    totalDisk += disk.size;
    usedDisk += disk.used;
    return {
      device: disk.device,
      type: disk.type,
      name: disk.name,
      mount: disk.mount,
      fsType: disk.fs,
      size: formatBytesSmart(disk.size),
      sizevalue: disk.size,
      used: formatBytesSmart(disk.used),
      usedvalue: disk.used,
      usagePercent: disk.use.toFixed(2) + '%',
      usagePercentvalue: disk.use
    };
  });

  const gpuList = graphicsInfo.controllers.map(gpu => {
    const total = gpu.vram || 0;
    const used = gpu.memoryUsed || 0;
    const free = total && used ? total - used : null;
    const usagePercent = total && used ? ((used / total) * 100).toFixed(2) : null;
    return {
      vendor: gpu.vendor,
      model: gpu.model,
      vram: formatBytesSmart(total),
      vramvalue: total,
      usedMemory: used ? formatBytesSmart(used) : '0',
      usedvalue: used,
      freeMemory: free !== null ? formatBytesSmart(free) : '0',
      freevalue: free,
      usagePercent: usagePercent !== null ? `${usagePercent}%` : '0',
      usagePercentvalue: usagePercent,
      temperature: gpu.temperatureGpu ? `${gpu.temperatureGpu} °C` : '0',
      temperaturevalue: gpu.temperatureGpu
    };
  });

  const cpuList = os.cpus().map((cpu, index) => ({
    core: index,
    model: cpu.model,
    speedMHz: cpu.speed,
    times: cpu.times
  }));

  return {
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      distro: osInfo.distro,
      release: osInfo.release,
      arch: os.arch(),
      kernel: osInfo.kernel,
      uptime: (os.uptime() / 60 / 60).toFixed(2) + ' hrs',
      uptimevalue: os.uptime(),
      ...osInfo
    },
    cpu: {
      model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
      speed: cpuInfo.speed + ' GHz',
      speedvalue: cpuInfo.speed,
      cores: cpuInfo.cores,
      physicalCores: cpuInfo.physicalCores
    },
    cpuList,
    gpu: gpuList,
    memory: {
      total: formatBytesSmart(totalMem),
      totalvalue: totalMem,
      free: formatBytesSmart(freeMem),
      freevalue: freeMem,
      used: formatBytesSmart(usedMem),
      usedvalue: usedMem,
      usagePercent: memUsagePercent.toFixed(2) + '%',
      usagePercentvalue: memUsagePercent,
      active: formatBytesSmart(activeMem),
      activevalue: activeMem,
      available: formatBytesSmart(availableMem),
      availablevalue: availableMem,
      buffers: formatBytesSmart(buffersMem),
      buffersvalue: buffersMem,      
      cached: formatBytesSmart(cachedMem),
      cachedvalue: cachedMem,
      swapTotal: formatBytesSmart(swapTotal),
      swapTotalvalue: swapTotal,
      swapUsed: formatBytesSmart(swapUsed),
      swapUsedvalue: swapUsed,
      swapFree: formatBytesSmart(swapFree),
      swapFreevalue: swapFree,
      swapUsagePercent: swapUsagePercent.toFixed(2) + '%',
      swapUsagePercentvalue: swapUsagePercent
    },
    disks: {
      total: formatBytesSmart(totalDisk),
      totalvalue: totalDisk,
      used: formatBytesSmart(usedDisk),
      usedvalue: usedDisk,
      free: formatBytesSmart(totalDisk - usedDisk),
      freevalue: totalDisk - usedDisk,
      usagePercent: ((usedDisk / totalDisk) * 100).toFixed(2) + '%',
      usagePercentvalue: usedDisk / totalDisk * 100,
      volumes: diskDetails
    },
    network: netInfo.map(net => ({
      iface: net.iface,
      ip4: net.ip4,
      mac: net.mac,
      internal: net.internal
    })),
    battery: {
      hasBattery: batteryInfo.hasBattery,
      percent: batteryInfo.percent,
      isCharging: batteryInfo.isCharging
    }
  };
};

// Helper function to execute commands
const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      resolve(stdout.trim());
    });
  });
};

app.get('/api/status', async (req, res) => {
  try {
    const info = await getSystemInfo();
    res.json({
      status: 'connected',
      time: new Date().toISOString(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      os: {
        type: os.type(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
      },
      ...info
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve system info', details: err.toString() });
  }
});


// Status endpoint
app.get('/api/status', async (req, res) => {
  const info = await getSystemInfo();
  res.json({
    status: 'connected',
    time: new Date().toISOString(),
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    ...info
  });
});

// System information
app.get('/api/system', async(req, res) => {
  
  try {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    let diskSpace = {};

    const info = await getSystemInfo();
    // Get disk space info
    if (isWindows) {
      const driveData = await executeCommand('wmic logicaldisk get size,freespace,caption');
      const drives = driveData.split('\n').slice(1)
        .filter(line => line.trim())
        .map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const caption = parts[0];
            const freeSpace = parseInt(parts[1], 10);
            const size = parseInt(parts[2], 10);
            return {
              drive: caption,
              total: formatBytesSmart(size),
              totalvalue: size,
              free: formatBytesSmart(freeSpace),
              freevalue: freeSpace,
              used: formatBytesSmart(size - freeSpace),
              usedvalue: size - freeSpace
            };
          }
          return null;
        })
        .filter(drive => drive);
      
      diskSpace = drives;
    } else if (isLinux) {
      const dfOutput = await executeCommand('df -BK');
      const lines = dfOutput.split('\n').slice(1);
      const filesystems = lines
        .filter(line => line.trim())
        .map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 6) {
            const filesystem = parts[0];
            const total = parseInt(parts[1], 10) * 1024;
            const used = parseInt(parts[2], 10) * 1024;
            const available = parseInt(parts[3], 10) * 1024;
            const mountpoint = parts[5];
            
            return {
              filesystem,
              total: formatBytesSmart(total),
              totalvalue: total,
              used: formatBytesSmart(used),
              usedvalue: used,
              free: formatBytesSmart(available),
              freevalue: available,
              mountpoint
            };
          }
          return null;
        })
        .filter(fs => fs);
      
      diskSpace = filesystems;
    }

    // Calculate CPU load
    const loadAvg = os.loadavg();
    
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      cpus: {
        count: cpus.length,
        model: cpus[0]?.model || 'Unknown',
        speed: cpus[0]?.speed || 0
      },
      memory: {
        total: formatBytesSmart(totalMemory),
        totalvalue: totalMemory,
        free: formatBytesSmart(freeMemory),
        freevalue: freeMemory,
        used: formatBytesSmart(usedMemory),
        usedvalue: usedMemory,
        percentUsed: `${((usedMemory / totalMemory * 100).toFixed(2))}%`,
        percentUsedvalue: usedMemory / totalMemory * 100
      },
      loadAvg,
      network: os.networkInterfaces(),
      diskSpace,
      ...info
    });
  } catch (error) {
    console.error('Error fetching system info:', error);
    res.status(500).json({ error: error.message });
  }
});

// PM2 processes
app.get('/api/pm2/processes', async (req, res) => {
  try {
    let processes = [];
    
    if (isWindows) {
      try {
        // Try to get PM2 processes on Windows
        const pm2List = await executeCommand('npx pm2 jlist');
        processes = JSON.parse(pm2List);
      } catch (err) {
        console.error('Error getting PM2 processes on Windows:', err);
        return res.status(500).json({ error: 'PM2 not available on this VM or not installed globally' });
      }
    } else if (isLinux) {
      try {
        // Try without sudo first
        const pm2List = await executeCommand('pm2 jlist');
        processes = JSON.parse(pm2List);
      } catch (err) {
        try {
          // Try with sudo if normal user doesn't have access
          const sudoPm2List = await executeCommand('sudo pm2 jlist');
          processes = JSON.parse(sudoPm2List);
        } catch (sudoErr) {
          console.error('Error getting PM2 processes on Linux:', sudoErr);
          return res.status(500).json({ error: 'PM2 not available on this VM or not installed globally' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json(processes);
  } catch (error) {
    console.error('Error fetching PM2 processes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single PM2 process by ID
app.get('/api/pm2/processes/:id', async (req, res) => {
  try {
    const processId = req.params.id;
    let processInfo = null;
    
    if (isWindows) {
      try {
        const pm2Describe = await executeCommand(`npx pm2 describe ${processId} --json`);
        processInfo = JSON.parse(pm2Describe);
      } catch (err) {
        console.error(`Error getting PM2 process ${processId} on Windows:`, err);
        return res.status(500).json({ error: 'PM2 not available or process not found' });
      }
    } else if (isLinux) {
      try {
        const pm2Describe = await executeCommand(`pm2 describe ${processId} --json`);
        processInfo = JSON.parse(pm2Describe);
      } catch (err) {
        try {
          const sudoPm2Describe = await executeCommand(`sudo pm2 describe ${processId} --json`);
          processInfo = JSON.parse(sudoPm2Describe);
        } catch (sudoErr) {
          console.error(`Error getting PM2 process ${processId} on Linux:`, sudoErr);
          return res.status(500).json({ error: 'PM2 not available or process not found' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json(processInfo);
  } catch (error) {
    console.error(`Error fetching PM2 process ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Restart PM2 process
app.post('/api/pm2/processes/:id/restart', async (req, res) => {
  try {
    const processId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`npx pm2 restart ${processId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`pm2 restart ${processId}`);
      } catch (err) {
        await executeCommand(`sudo pm2 restart ${processId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Process ${processId} restarted` });
  } catch (error) {
    console.error(`Error restarting PM2 process ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Stop PM2 process
app.post('/api/pm2/processes/:id/stop', async (req, res) => {
  try {
    const processId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`npx pm2 stop ${processId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`pm2 stop ${processId}`);
      } catch (err) {
        await executeCommand(`sudo pm2 stop ${processId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Process ${processId} stopped` });
  } catch (error) {
    console.error(`Error stopping PM2 process ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Start PM2 process
app.post('/api/pm2/processes/:id/start', async (req, res) => {
  try {
    const processId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`npx pm2 start ${processId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`pm2 start ${processId}`);
      } catch (err) {
        await executeCommand(`sudo pm2 start ${processId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Process ${processId} started` });
  } catch (error) {
    console.error(`Error starting PM2 process ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get PM2 process logs
app.get('/api/pm2/processes/:id/logs', async (req, res) => {
  try {
    const processId = req.params.id;
    const lines = req.query.lines || 100;
    let logs = { out: '', error: '' };
    
    if (isWindows) {
      try {
        // Get out logs
        const outLogs = await executeCommand(`npx pm2 logs ${processId} --lines ${lines} --nostream --out`);
        // Get error logs
        const errorLogs = await executeCommand(`npx pm2 logs ${processId} --lines ${lines} --nostream --err`);
        
        logs = { out: outLogs, error: errorLogs };
      } catch (err) {
        console.error(`Error getting PM2 logs for process ${processId} on Windows:`, err);
        return res.status(500).json({ error: 'PM2 not available or process not found' });
      }
    } else if (isLinux) {
      try {
        // Get out logs
        const outLogs = await executeCommand(`pm2 logs ${processId} --lines ${lines} --nostream --out`);
        // Get error logs
        const errorLogs = await executeCommand(`pm2 logs ${processId} --lines ${lines} --nostream --err`);
        
        logs = { out: outLogs, error: errorLogs };
      } catch (err) {
        try {
          // Try with sudo
          const sudoOutLogs = await executeCommand(`sudo pm2 logs ${processId} --lines ${lines} --nostream --out`);
          const sudoErrorLogs = await executeCommand(`sudo pm2 logs ${processId} --lines ${lines} --nostream --err`);
          
          logs = { out: sudoOutLogs, error: sudoErrorLogs };
        } catch (sudoErr) {
          console.error(`Error getting PM2 logs for process ${processId} on Linux:`, sudoErr);
          return res.status(500).json({ error: 'PM2 not available or process not found' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json(logs);
  } catch (error) {
    console.error(`Error fetching logs for PM2 process ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Docker containers
app.get('/api/docker/containers', async (req, res) => {
  try {
    let containers = [];
    
    if (isWindows) {
      try {
        const dockerPs = await executeCommand('docker ps -a --format "{{json .}}"');
        containers = dockerPs.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } catch (err) {
        console.error('Error getting Docker containers on Windows:', err);
        return res.status(500).json({ error: 'Docker not available on this VM' });
      }
    } else if (isLinux) {
      try {
        const dockerPs = await executeCommand('docker ps -a --format "{{json .}}"');
        containers = dockerPs.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } catch (err) {
        try {
          const sudoDockerPs = await executeCommand('sudo docker ps -a --format "{{json .}}"');
          containers = sudoDockerPs.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
        } catch (sudoErr) {
          console.error('Error getting Docker containers on Linux:', sudoErr);
          return res.status(500).json({ error: 'Docker not available on this VM' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    // Process containers and extract stack information
    const processedContainers = containers.map(container => {
      // Extract stack name from container name
      // Docker Compose typically uses format: stackname_servicename_instancenumber
      let stackName = 'default';
      const nameWithoutSlash = container.Names.replace(/^\//, '');
      
      // Check if the name follows the docker-compose pattern
      const nameParts = nameWithoutSlash.split('_');
      if (nameParts.length >= 2) {
        stackName = nameParts[0];
      }
      
      return {
        Id: container.ID,
        Names: [container.Names],
        Image: container.Image,
        Command: container.Command,
        Created: container.CreatedAt,
        State: container.State,
        Status: container.Status,
        Stack: stackName,
        Ports: container.Ports ? container.Ports.split(', ').filter(part => String(part).includes('->')).map(port => {
          const parts = port.split('->');
          return {
            IP: parts[0].split(":")[0],
            PublicPort: parseInt(parts[0].split(":")[1], 10),
            PrivatePort: parseInt(parts[1], 10) || null,
            Type: 'tcp',
            parts
          };
        }) : [],
        containerPorts: container.Ports
      };
    });
    
    // Group containers by stack
    const stacksMap = {};
    processedContainers.forEach(container => {
      if (!stacksMap[container.Stack]) {
        stacksMap[container.Stack] = [];
      }
      stacksMap[container.Stack].push(container);
    });
    
    // Convert to array format with stack info
    const stacksArray = Object.keys(stacksMap).map(stackName => ({
      name: stackName,
      containers: stacksMap[stackName],
      count: stacksMap[stackName].length,
      running: stacksMap[stackName].filter(c => c.State === 'running').length
    }));
    
    res.json(processedContainers);
  } catch (error) {
    console.error('Error fetching Docker containers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific Docker container
app.get('/api/docker/containers/:id', async (req, res) => {
  try {
    const containerId = req.params.id;
    let containerInfo = null;
    
    if (isWindows) {
      try {
        const dockerInspect = await executeCommand(`docker inspect ${containerId}`);
        containerInfo = JSON.parse(dockerInspect)[0];
      } catch (err) {
        console.error(`Error getting Docker container ${containerId} on Windows:`, err);
        return res.status(500).json({ error: 'Docker not available or container not found' });
      }
    } else if (isLinux) {
      try {
        const dockerInspect = await executeCommand(`docker inspect ${containerId}`);
        containerInfo = JSON.parse(dockerInspect)[0];
      } catch (err) {
        try {
          const sudoDockerInspect = await executeCommand(`sudo docker inspect ${containerId}`);
          containerInfo = JSON.parse(sudoDockerInspect)[0];
        } catch (sudoErr) {
          console.error(`Error getting Docker container ${containerId} on Linux:`, sudoErr);
          return res.status(500).json({ error: 'Docker not available or container not found' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json(containerInfo);
  } catch (error) {
    console.error(`Error fetching Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get container stats
app.get('/api/docker/containers/:id/stats', async (req, res) => {
  try {
    const containerId = req.params.id;
    let stats = null;
    
    if (isWindows) {
      try {
        const dockerStats = await executeCommand(`docker stats ${containerId} --no-stream --format "{{json .}}"`);
        stats = JSON.parse(dockerStats);
      } catch (err) {
        console.error(`Error getting Docker stats for container ${containerId} on Windows:`, err);
        return res.status(500).json({ error: 'Docker not available or container not found' });
      }
    } else if (isLinux) {
      try {
        const dockerStats = await executeCommand(`docker stats ${containerId} --no-stream --format "{{json .}}"`);
        stats = JSON.parse(dockerStats);
      } catch (err) {
        try {
          const sudoDockerStats = await executeCommand(`sudo docker stats ${containerId} --no-stream --format "{{json .}}"`);
          stats = JSON.parse(sudoDockerStats);
        } catch (sudoErr) {
          console.error(`Error getting Docker stats for container ${containerId} on Linux:`, sudoErr);
          return res.status(500).json({ error: 'Docker not available or container not found' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json(stats);
  } catch (error) {
    console.error(`Error fetching stats for Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Restart container
app.post('/api/docker/containers/:id/restart', async (req, res) => {
  try {
    const containerId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`docker restart ${containerId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`docker restart ${containerId}`);
      } catch (err) {
        await executeCommand(`sudo docker restart ${containerId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Container ${containerId} restarted` });
  } catch (error) {
    console.error(`Error restarting Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Stop container
app.post('/api/docker/containers/:id/stop', async (req, res) => {
  try {
    const containerId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`docker stop ${containerId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`docker stop ${containerId}`);
      } catch (err) {
        await executeCommand(`sudo docker stop ${containerId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Container ${containerId} stopped` });
  } catch (error) {
    console.error(`Error stopping Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Start container
app.post('/api/docker/containers/:id/start', async (req, res) => {
  try {
    const containerId = req.params.id;
    
    if (isWindows) {
      await executeCommand(`docker start ${containerId}`);
    } else if (isLinux) {
      try {
        await executeCommand(`docker start ${containerId}`);
      } catch (err) {
        await executeCommand(`sudo docker start ${containerId}`);
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ success: true, message: `Container ${containerId} started` });
  } catch (error) {
    console.error(`Error starting Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get container logs
app.get('/api/docker/containers/:id/logs', async (req, res) => {
  try {
    const containerId = req.params.id;
    const lines = req.query.lines || 100;
    let logs = '';
    
    if (isWindows) {
      try {
        logs = await executeCommand(`docker logs --tail ${lines} ${containerId}`);
      } catch (err) {
        console.error(`Error getting Docker logs for container ${containerId} on Windows:`, err);
        return res.status(500).json({ error: 'Docker not available or container not found' });
      }
    } else if (isLinux) {
      try {
        logs = await executeCommand(`docker logs --tail ${lines} ${containerId}`);
      } catch (err) {
        try {
          logs = await executeCommand(`sudo docker logs --tail ${lines} ${containerId}`);
        } catch (sudoErr) {
          console.error(`Error getting Docker logs for container ${containerId} on Linux:`, sudoErr);
          return res.status(500).json({ error: 'Docker not available or container not found' });
        }
      }
    } else {
      return res.status(500).json({ error: 'Unsupported operating system' });
    }
    
    res.json({ logs });
  } catch (error) {
    console.error(`Error fetching logs for Docker container ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Test connection endpoint that returns comprehensive VM details
app.post('/api/vm/connect', async (req, res) => {
  try {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    let result = {
      status: 'connected',
      timestamp: new Date().toISOString(),
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptime: os.uptime(),
        memory: {
          total: formatBytesSmart(totalMemory),
          totalvalue: totalMemory,
          free: formatBytesSmart(freeMemory),
          freevalue: freeMemory,
          used: formatBytesSmart(usedMemory),
          usedvalue: usedMemory
        },
        cpus: os.cpus().length
      },
      docker: { available: false, containers: [] },
      pm2: { available: false, processes: [] }
    };

    // Get disk usage
    try {
      if (isWindows) {
        const driveData = await executeCommand('wmic logicaldisk get size,freespace,caption');
        const drives = driveData.split('\n').slice(1)
          .filter(line => line.trim())
          .map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const caption = parts[0];
              const freeSpace = parseInt(parts[1], 10);
              const size = parseInt(parts[2], 10);
              return {
                drive: caption,
                total: size,
                free: freeSpace,
                used: size - freeSpace
              };
            }
            return null;
          })
          .filter(drive => drive);
        
        result.system.disks = drives;
      } else if (isLinux) {
        const dfOutput = await executeCommand('df -BK');
        const lines = dfOutput.split('\n').slice(1);
        const filesystems = lines
          .filter(line => line.trim())
          .map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 6) {
              const filesystem = parts[0];
              const total = parseInt(parts[1], 10) * 1024;
              const used = parseInt(parts[2], 10) * 1024;
              const available = parseInt(parts[3], 10) * 1024;
              const mountpoint = parts[5];
              
              return {
                filesystem,
                total,
                used,
                free: available,
                mountpoint
              };
            }
            return null;
          })
          .filter(fs => fs);
        
        result.system.disks = filesystems;
      }
    } catch (diskError) {
      console.error('Error getting disk information:', diskError);
      result.system.disks = { error: diskError.message };
    }

    // Try to get Docker containers
    try {
      let dockerCommand;
      if (isWindows) {
        dockerCommand = 'docker ps -a --format "{{json .}}"';
      } else if (isLinux) {
        try {
          dockerCommand = 'docker ps -a --format "{{json .}}"';
          await executeCommand(dockerCommand); // Test if command works
        } catch (err) {
          dockerCommand = 'sudo docker ps -a --format "{{json .}}"';
        }
      }

      const dockerPs = await executeCommand(dockerCommand);
      const containers = dockerPs.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      result.docker = {
        available: true,
        count: containers.length,
        running: containers.filter(c => c.State === 'running').length,
        containers: containers.map(c => ({
          id: c.ID,
          name: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status
        }))
      };
    } catch (dockerError) {
      console.error('Docker not available:', dockerError.message);
      result.docker = {
        available: false,
        error: dockerError.message
      };
    }

    // Try to get PM2 processes
    try {
      let pm2Command;
      if (isWindows) {
        pm2Command = 'npx pm2 jlist';
      } else if (isLinux) {
        try {
          pm2Command = 'pm2 jlist';
          await executeCommand(pm2Command); // Test if command works
        } catch (err) {
          pm2Command = 'sudo pm2 jlist';
        }
      }

      const pm2List = await executeCommand(pm2Command);
      const processes = JSON.parse(pm2List);
      
      result.pm2 = {
        available: true,
        count: processes.length,
        online: processes.filter(p => p.pm2_env?.status === 'online').length,
        errored: processes.filter(p => p.pm2_env?.status === 'errored').length,
        stopped: processes.filter(p => p.pm2_env?.status === 'stopped').length,
        processes: processes.map(p => ({
          id: p.pm_id,
          name: p.name,
          status: p.pm2_env?.status || 'unknown',
          memory: p.monit?.memory,
          cpu: p.monit?.cpu
        }))
      };
    } catch (pm2Error) {
      console.error('PM2 not available:', pm2Error.message);
      result.pm2 = {
        available: false,
        error: pm2Error.message
      };
    }
    
    const info = await getSystemInfo();
    result = { ...result, ...info }
    res.json(result);
  } catch (error) {
    console.error('Error in test connection endpoint:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`VM Monitoring Agent running on port ${PORT}`);
  console.log(`OS: ${os.type()} (${os.platform()})`);
  console.log(`Hostname: ${os.hostname()}`);
});
