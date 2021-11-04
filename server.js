console.log("start server!");
var cluster = require('cluster');  
if (cluster.isMaster) {  
    var cpus = require('os').cpus().length;
    for (var i = 0; i < cpus; i += 1) {
        cluster.fork();
    }    
} else {
    var bodyParser = require('body-parser');
    var express = require('express');
    var path = require('path')
    var fetch = require("node-fetch");
    var fs = require('fs');
    var http = require('http');
    var cors = require('cors');
    var fileUpload = require('express-fileupload');
    var mysql = require('mysql2/promise');
    var hasher = require('./perceptual_hashing.js');
    var sizeOf = require('image-size')
    var Jimp = require('jimp');



    const connection = mysql.createPool({
          connectionLimit: 20,
          host: process.env.MYSQL_HOST || "localhost",
          user: process.env.MYSQL_USER || "root",
          password: process.env.MYSQL_PASSWORD || "password",
          database: process.env.MYSQL_DATABASE || "test",
    });

    var app = express();
    var port = process.env.EXPRESS_PORT || "80";
    var host = process.env.EXPRESS_HOST || '0.0.0.0';
    port = parseInt(port)

    http.createServer(app).listen(port, host, function (e) {
        if(e){
            console.log("error catch 80");
            if(!canRunSSH){
                return;
            }
        }
    });

    var exec = require('child_process').exec, child;

    
    app.use(cors({origin: '*'}));
    // app.use(bodyParser.urlencoded({
    //     extended: true
    // }));
    // app.use(bodyParser.json());
    app.use( bodyParser.json({limit: '50mb'}) );
    app.use(bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
      parameterLimit:50000
    }));

    app.use(fileUpload());
    var options = {
      index: "coming-soon.html"
    };
    app.use(express.static('views',options));
 



    app.get('*', async (req, res) => {
      if(req.originalUrl.indexOf("/get") != -1){
          var scale = req.query.scale || 1.0;
          scale = parseFloat(scale)
          var rows = await connection.query("SELECT * FROM Image WHERE id='" + req.query.id + "'");
          rows = rows[0]
          if(rows.length > 0){
              var imageDir = rows[0].directory
              var tempImageDir = imageDir.replace("usr/src/views/","usr/src/views/temp/")
              const dimensions = sizeOf(imageDir)
              var width = dimensions.width
              var height = dimensions.height

              var newWidth = Math.round(width*scale)
              var newHeight = Math.round(height*scale)
              Jimp.read(imageDir, (err, img) => {
                if (err) throw err;

                img.resize(newWidth, newHeight) // resize
                  .quality(100) // set JPEG quality
                  .write(tempImageDir, async () =>{
                    res.sendFile(tempImageDir);   
                  }); // save
              });
              

          }else{
              res.json({
                status: "Картинка не найдена найдена"
              });
          }
      }
    });

    app.post('/upload', async (req, res) => {
        if(req.files == undefined){
            return res.json({
                status: "Вы забыли приложить изображение"
            });
        }
        var sampleFile = req.files.file;
        if(sampleFile == undefined){
            return res.json({
                status: "Вы забыли приложить изображение"
            });
        }
        var fileName = req.files.file.name;

        var scale = req.body.scale || 1.0;
        var thresholdSimilarity = req.body.thresholdSimilarity || 90;

        scale = parseFloat(scale)
        console.log("scale: " + scale)


        var partsName = fileName.split(".")
        fileName = Date.now() + "." + partsName[partsName.length - 1];
        var tempFullPath = "/usr/src/views/temp/" + fileName;
        var fullPath = "/usr/src/views/" + fileName;
        console.log("sampleFile: " + sampleFile)   
        console.log("fullPath: " + fullPath)     
        sampleFile.mv(tempFullPath, async(err) => {
            console.log("err: "+err);
            // const hash0 = await hasher.hash(tempFullPath,4);
            const hash1 = await hasher.hash(tempFullPath,16);
            const dimensions = sizeOf(tempFullPath)
            var width = dimensions.width
            var height = dimensions.height
            console.log(dimensions.width, dimensions.height)
            console.log("hash1: "+hash1);
            try {
              var similarImages = await connection.query("SELECT im.id, levenshtein_ratio(im.hash, '"+hash1+"') AS score FROM Image im HAVING score >= "+thresholdSimilarity);
              console.log("similarImages: "+JSON.stringify(similarImages));

              var rows = undefined;
              if(similarImages[0].length > 0){
                  rows = await connection.query("SELECT * FROM Image WHERE id='" + similarImages[0][0].id + "'");
                  rows = rows[0]
              }
              
              if(rows != undefined && rows.length > 0){
                  if((rows[0].width/rows[0].height).toFixed(2) != (width/height).toFixed(2)){
                      sampleFile.mv(fullPath, async(err) => {
                          var rows2 = await connection.query("INSERT INTO Image (hash,name,directory,url,width,height,scale,modifiedAt) VALUES ('"+hash1+"','"+fileName+"','"+fullPath+"','http://137.184.70.55/"+fileName+"',"+width+","+height+","+scale+",'"+(new Date().toISOString().slice(0, 19).replace('T', ' '))+"')");
                          res.json({
                              status: "Изображение успешно добавлено. Оно было в базе, но с другим соотношением сторон",
                              id: rows2[0].insertId,
                              score: similarImages[0][0].score,
                              url: "http://137.184.70.55/get?id="+rows[0].insertId
                          });
                      });
                  }else{

                      if(width*height > rows[0].width*rows[0].height){
                          sampleFile.mv(fullPath, async(err) => {
                          var rows2 = await connection.query("UPDATE Image SET hash='"+hash1+"', name='"+fileName+"', directory='"+fullPath+"', url='http://137.184.70.55/"+fileName+"', width="+width+", height="+height+", scale="+scale+", modifiedAt='"+(new Date().toISOString().slice(0, 19).replace('T', ' '))+"' WHERE id ="+rows[0].id);
                              res.json({
                                  status: "Изображение успешно заменено, так как размер стал больше",
                                  id: rows[0].id,
                                  score: similarImages[0][0].score,
                                  url: "http://137.184.70.55/get?id="+rows[0].id
                              });
                          });
                      }else{
                          res.json({
                            status: "Изображение уже существует",
                            id: rows[0].id,
                            score: similarImages[0][0].score,
                            url: "http://137.184.70.55/get?id="+rows[0].id
                          });
                      }
                  }
                  
                  
              }else{
                  sampleFile.mv(fullPath, async(err) => {
                      var rows = await connection.query("INSERT INTO Image (hash,name,directory,url,width,height,scale,modifiedAt) VALUES ('"+hash1+"','"+fileName+"','"+fullPath+"','http://137.184.70.55/"+fileName+"',"+width+","+height+","+scale+",'"+(new Date().toISOString().slice(0, 19).replace('T', ' '))+"')");
                      res.json({
                          status: "Изображение успешно добавлено",
                          id: rows[0].insertId,
                          url: "http://137.184.70.55/get?id="+rows[0].insertId
                      });
                  });
              }

            } catch (err) {
                res.json({
                  success: false,
                  err:err.message,
                });
            }
        });
    });

    app.post('/step1/upload', async (req, res) => {
        if(req.files == undefined){
            return res.json({
                status: "Вы забыли приложить изображение"
            });
        }
        var sampleFile = req.files.file;
        if(sampleFile == undefined){
            return res.json({
                status: "Вы забыли приложить изображение"
            });
        }
        var fileName = req.files.file.name;

        var scale = req.body.scale || 1.0;
        scale = parseFloat(scale)
        console.log("scale: " + scale)

        var partsName = fileName.split(".")
        fileName = Date.now() + "." + partsName[partsName.length - 1];
        var tempFullPath = "/usr/src/views/temp/" + fileName;
        var fullPath = "/usr/src/views/" + fileName;
        console.log("sampleFile: " + sampleFile)   
        console.log("fullPath: " + fullPath)     
        sampleFile.mv(tempFullPath, async(err) => {
            console.log("err: "+err);
            const hash1 = "withot hash";
            const dimensions = sizeOf(tempFullPath)
            var width = dimensions.width
            var height = dimensions.height
            console.log(dimensions.width, dimensions.height)
            try {
              sampleFile.mv(fullPath, async(err) => {
                  var rows = await connection.query("INSERT INTO Image (hash,name,directory,url,width,height,scale,modifiedAt) VALUES ('"+hash1+"','"+fileName+"','"+fullPath+"','http://137.184.70.55/"+fileName+"',"+width+","+height+","+scale+",'"+(new Date().toISOString().slice(0, 19).replace('T', ' '))+"')");
                  res.json({
                      status: "Изображение успешно добавлено",
                      id: rows[0].insertId
                  });
              });

            } catch (err) {
                res.json({
                  success: false,
                  err:err.message,
                });
            }
        });
    });
}

