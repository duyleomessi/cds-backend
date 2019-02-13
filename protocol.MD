# Những data từ client gửi lên

## Một trong 2 đội có trục trặc, lùi về vị trí xuất phát
### Vòng 1 thì là G1, R1
```
G1:START:START
R1:START:START
```
### Vòng 2 thì là G2, R2
```
G2:START:START
R2:START:START
```

## Bản tin khi 1 trong 2 đội đi qua các mốc tính điểm
```
G1:P1:12.23 => Sân green, mốc 1, thời gian từ lúc start là 12.23s
Có tất cả là 5 mốc: P1 -> P5
```

# Những data mà server gửi cho client
## Đối với vòng 1
### Khi admin bấm bắt đầu thi đấu
```
RACE_START_ROUND_1\n
```

### Khi server đếm lùi hết 3 phút thì gửi
```
RACE_STOP_ROUND_1\n
```

### Khi admin bấm Reset lại trận đấu
```
RACE_RESET_ROUND_1\n
```

## Đối với vòng 2
### Khi admin bấm bắt đầu thi đấu
```
RACE_START_ROUND_2\n
```

### Khi server đếm lùi hết 3 phút thì gửi
```
RACE_STOP_ROUND_2\n
```

### Khi admin bấm Reset lại trận đấu
```
RACE_RESET_ROUND_2\n
```

## Đối với vòng bán kết 
### Khi admin bấm bắt đầu thi đấu
```
RACE_START_ROUND_2\n
```

### Khi server đếm lùi hết 3 phút thì gửi
```
RACE_STOP_ROUND_2\n
```

### Khi admin bấm Reset lại trận đấu
```
RACE_RESET_ROUND_2\n
```

### Data mẫu để test khi thi đấu
```
client.write("G1:P1:10.4")
client.write("G1:P2:15.4")
client.write("G1:P3:19.4")
client.write("G1:P4:25.4")
client.write("G1:P5:30.4")
client.write("G1:P1:10.4")
client.write("G1:P2:15.4")
client.write("G1:P3:19.4")
client.write("G1:P4:25.4")
client.write("G1:P5:26.4")

client.write("R1:P1:10.4")
client.write("R1:P2:15.4")
client.write("R1:P3:19.4")
client.write("R1:P4:25.4")
```