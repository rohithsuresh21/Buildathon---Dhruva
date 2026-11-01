import sharp from 'sharp';
const src='/home/claude/tex_test/';
await sharp(src+'2_no_clouds_4k.jpg').resize(4096,2048).jpeg({quality:80,mozjpeg:true}).toFile('public/tex/day.jpg');
await sharp(src+'earth-night.jpg').resize(4096,2048).jpeg({quality:78,mozjpeg:true}).toFile('public/tex/night.jpg');
await sharp(src+'fair_clouds_4k.png').resize(2048,1024).greyscale().jpeg({quality:70,mozjpeg:true}).toFile('public/tex/clouds.jpg');
await sharp(src+'water_4k.png').resize(2048,1024).greyscale().jpeg({quality:70,mozjpeg:true}).toFile('public/tex/water.jpg');
await sharp(src+'earth-topology.png').resize(2048,1024).greyscale().jpeg({quality:70,mozjpeg:true}).toFile('public/tex/bump.jpg');
